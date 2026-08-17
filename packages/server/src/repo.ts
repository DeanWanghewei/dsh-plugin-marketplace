import type { CategoryDef, PluginEntry, RegistryData } from '@dshm/core'
import type { CategoryRow, PluginRow, QueryApi, SqlDriver } from './driver-types.js'

/** Typed query layer over either database backend. */

export interface ListFilters {
  q?: string
  category?: string
  tag?: string
  limit: number
  offset: number
}

function rowToEntry(row: PluginRow, categories: string[]): PluginEntry {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    categories,
    tags: JSON.parse(row.tags_json) as string[],
    author: row.author ?? undefined,
    homepage: row.homepage ?? undefined,
    license: row.license ?? undefined,
    verified: row.verified === 1,
    source: JSON.parse(row.source_json) as PluginEntry['source'],
  }
}

function rowToCategory(row: CategoryRow): CategoryDef {
  return {
    id: row.id,
    name: { zh: row.name_zh ?? undefined, en: row.name_en ?? undefined },
    parent: row.parent,
    description: row.description ?? undefined,
  }
}

export class RegistryRepo {
  constructor(private readonly driver: SqlDriver) {}

  async listPlugins(filters: ListFilters): Promise<{ total: number; items: PluginEntry[] }> {
    const where: string[] = []
    const params: unknown[] = []
    if (filters.q) {
      const needle = `%${filters.q}%`
      where.push('(p.id LIKE ? OR p.name LIKE ? OR p.description LIKE ? OR p.tags_json LIKE ?)')
      params.push(needle, needle, needle, needle)
    }
    if (filters.category) {
      where.push(
        'EXISTS (SELECT 1 FROM plugin_categories pc WHERE pc.plugin_id = p.id AND pc.category_id = ?)',
      )
      params.push(filters.category)
    }
    if (filters.tag) {
      where.push('p.tags_json LIKE ?')
      params.push(`%"${filters.tag}"%`)
    }
    const clause = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''
    const total = (
      await this.driver.get<{ n: number }>(`SELECT COUNT(*) AS n FROM plugins p${clause}`, params)
    )?.n
    const rows = await this.driver.all<PluginRow>(
      `SELECT * FROM plugins p${clause} ORDER BY p.id LIMIT ? OFFSET ?`,
      [...params, filters.limit, filters.offset],
    )
    const categories = await this.categoriesByPlugin(rows.map((row) => row.id))
    return {
      total: total ?? 0,
      items: rows.map((row) => rowToEntry(row, categories.get(row.id) ?? [])),
    }
  }

  async getPlugin(id: string): Promise<PluginEntry | undefined> {
    const row = await this.driver.get<PluginRow>('SELECT * FROM plugins WHERE id = ?', [id])
    if (!row) return undefined
    const categories = await this.categoriesByPlugin([row.id])
    return rowToEntry(row, categories.get(row.id) ?? [])
  }

  async listCategories(): Promise<Array<CategoryDef & { count: number }>> {
    const rows = await this.driver.all<CategoryRow & { count: number }>(
      `SELECT c.*, (SELECT COUNT(*) FROM plugin_categories pc WHERE pc.category_id = c.id) AS count
       FROM categories c ORDER BY count DESC, c.id`,
    )
    return rows.map((row) => ({ ...rowToCategory(row), count: Number(row.count) }))
  }

  async upsertPlugin(entry: PluginEntry, tx?: QueryApi): Promise<void> {
    const q = tx ?? this.driver
    await q.run(this.driver.dialect.upsertPluginSql, [
      entry.id,
      entry.name,
      entry.description,
      entry.author ?? null,
      entry.homepage ?? null,
      entry.license ?? null,
      entry.verified ? 1 : 0,
      entry.source.type,
      JSON.stringify(entry.source),
      JSON.stringify(entry.tags),
      new Date().toISOString(),
    ])
    await q.run('DELETE FROM plugin_categories WHERE plugin_id = ?', [entry.id])
    // Deduped so a plain INSERT suffices — INSERT IGNORE syntax differs by dialect.
    for (const categoryId of new Set(entry.categories)) {
      await q.run('INSERT INTO plugin_categories(plugin_id, category_id) VALUES(?, ?)', [
        entry.id,
        categoryId,
      ])
    }
  }

  async deletePlugin(id: string): Promise<boolean> {
    const result = await this.driver.run('DELETE FROM plugins WHERE id = ?', [id])
    await this.driver.run('DELETE FROM plugin_categories WHERE plugin_id = ?', [id])
    return result.changes > 0
  }

  async upsertCategory(category: CategoryDef): Promise<void> {
    await this.driver.run(this.driver.dialect.upsertCategorySql, [
      category.id,
      category.name.zh ?? null,
      category.name.en ?? null,
      category.parent,
      category.description ?? null,
    ])
  }

  async deleteCategory(id: string): Promise<boolean> {
    await this.driver.run('DELETE FROM plugin_categories WHERE category_id = ?', [id])
    const result = await this.driver.run('DELETE FROM categories WHERE id = ?', [id])
    return result.changes > 0
  }

  /** Replace (wipe) or merge a registry document into the database. */
  async importRegistry(
    data: RegistryData,
    mode: 'replace' | 'merge',
  ): Promise<{ plugins: number }> {
    return this.driver.transaction(async (tx) => {
      if (mode === 'replace') {
        await tx.run('DELETE FROM plugin_categories')
        await tx.run('DELETE FROM plugins')
      }
      for (const category of data.categories) {
        await tx.run(this.driver.dialect.upsertCategorySql, [
          category.id,
          category.name.zh ?? null,
          category.name.en ?? null,
          category.parent,
          category.description ?? null,
        ])
      }
      for (const plugin of data.plugins) {
        await this.upsertPlugin(plugin, tx)
      }
      return { plugins: data.plugins.length }
    })
  }

  /** Full registry document — the YAML export the CLI consumes. */
  async exportRegistry(name: string): Promise<RegistryData> {
    const { items } = await this.listPlugins({ limit: 1_000_000, offset: 0 })
    const categories = (await this.listCategories()).map(
      ({ count: _count, ...category }) => category,
    )
    return { schemaVersion: 1, name, categories, plugins: items }
  }

  async countPlugins(): Promise<number> {
    return (await this.driver.get<{ n: number }>('SELECT COUNT(*) AS n FROM plugins'))?.n ?? 0
  }

  private async categoriesByPlugin(ids: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>()
    if (ids.length === 0) return map
    const placeholders = ids.map(() => '?').join(',')
    const rows = await this.driver.all<{ plugin_id: string; category_id: string }>(
      `SELECT plugin_id, category_id FROM plugin_categories WHERE plugin_id IN (${placeholders})`,
      ids,
    )
    for (const row of rows) {
      const list = map.get(row.plugin_id) ?? []
      list.push(row.category_id)
      map.set(row.plugin_id, list)
    }
    return map
  }
}
