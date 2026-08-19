import type { CategoryDef, PluginEntry, PluginImage, RegistryData } from '@dshm/core'
import type { CategoryRow, PluginRow, QueryApi, SqlDriver } from './driver-types.js'

/** Typed query layer over either database backend. */

export interface ListFilters {
  q?: string
  category?: string
  tag?: string
  limit: number
  offset: number
}

/** Plugin entry plus serving-time aggregates (download count). */
export interface PluginView extends PluginEntry {
  downloads: number
}

type PluginViewRow = PluginRow & { downloads: number | bigint }

function rowToEntry(row: PluginViewRow, categories: string[]): PluginView {
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
    images: row.images_json ? (JSON.parse(row.images_json) as PluginImage[]) : [],
    ...(row.deps_json
      ? (JSON.parse(row.deps_json) as Pick<PluginEntry, 'requires' | 'requiresServices' | 'providesServices'>)
      : {}),
    downloads: Number(row.downloads ?? 0),
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

  async listPlugins(filters: ListFilters): Promise<{ total: number; items: PluginView[] }> {
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
    const rows = await this.driver.all<PluginViewRow>(
      `SELECT p.*, (SELECT COUNT(*) FROM download_events de WHERE de.plugin_id = p.id) AS downloads
       FROM plugins p${clause} ORDER BY p.id LIMIT ? OFFSET ?`,
      [...params, filters.limit, filters.offset],
    )
    const categories = await this.categoriesByPlugin(rows.map((row) => row.id))
    return {
      total: total ?? 0,
      items: rows.map((row) => rowToEntry(row, categories.get(row.id) ?? [])),
    }
  }

  async getPlugin(id: string): Promise<PluginView | undefined> {
    const row = await this.driver.get<PluginViewRow>(
      `SELECT p.*, (SELECT COUNT(*) FROM download_events de WHERE de.plugin_id = p.id) AS downloads
       FROM plugins p WHERE p.id = ?`,
      [id],
    )
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
      JSON.stringify(entry.images ?? []),
      JSON.stringify({
        requires: entry.requires ?? [],
        requiresServices: entry.requiresServices ?? [],
        providesServices: entry.providesServices ?? [],
      }),
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
    // Serving-time aggregates (downloads) are not part of the registry format.
    const plugins = items.map(({ downloads: _downloads, ...entry }) => entry)
    return { schemaVersion: 1, name, categories, plugins }
  }

  async countPlugins(): Promise<number> {
    return (await this.driver.get<{ n: number }>('SELECT COUNT(*) AS n FROM plugins'))?.n ?? 0
  }

  /** Record one install event; the plugin row supplies the source dimension. */
  async reportDownload(
    pluginId: string,
    client: string,
    version?: string,
  ): Promise<{ sourceType: string } | undefined> {
    const plugin = await this.driver.get<{ source_type: string }>(
      'SELECT source_type FROM plugins WHERE id = ?',
      [pluginId],
    )
    if (!plugin) return undefined
    await this.driver.run(
      'INSERT INTO download_events(at, plugin_id, client, source_type, version) VALUES(?, ?, ?, ?, ?)',
      [new Date().toISOString(), pluginId, client, plugin.source_type, version ?? null],
    )
    return { sourceType: plugin.source_type }
  }

  async statsDownloads(top: number): Promise<{
    total: number
    top: Array<{ id: string; name: string; downloads: number }>
    byClient: Array<{ client: string; downloads: number }>
    bySource: Array<{ source_type: string; downloads: number }>
  }> {
    const total =
      (await this.driver.get<{ n: number }>('SELECT COUNT(*) AS n FROM download_events'))?.n ?? 0
    const topRows = await this.driver.all<{ id: string; name: string; downloads: number }>(
      `SELECT p.id, p.name, COUNT(*) AS downloads
       FROM download_events de JOIN plugins p ON p.id = de.plugin_id
       GROUP BY p.id, p.name ORDER BY downloads DESC, p.id LIMIT ?`,
      [top],
    )
    const byClient = await this.driver.all<{ client: string; downloads: number }>(
      'SELECT client, COUNT(*) AS downloads FROM download_events GROUP BY client ORDER BY downloads DESC',
    )
    const bySource = await this.driver.all<{ source_type: string; downloads: number }>(
      'SELECT source_type, COUNT(*) AS downloads FROM download_events GROUP BY source_type ORDER BY downloads DESC',
    )
    return {
      total,
      top: topRows.map((row) => ({ ...row, downloads: Number(row.downloads) })),
      byClient: byClient.map((row) => ({ ...row, downloads: Number(row.downloads) })),
      bySource: bySource.map((row) => ({ ...row, downloads: Number(row.downloads) })),
    }
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

export interface GroupRow {
  name: string
  description: string
  plugins: string[]
  profile: string
  createdAt: string
}

export async function listGroups(driver: SqlDriver): Promise<GroupRow[]> {
  const rows = await driver.all<{
    name: string
    description: string | null
    plugins_json: string
    profile: string | null
    created_at: string
  }>('SELECT * FROM plugin_groups ORDER BY name')
  return rows.map((row) => ({
    name: row.name,
    description: row.description ?? '',
    plugins: JSON.parse(row.plugins_json) as string[],
    profile: row.profile ?? 'web',
    createdAt: row.created_at,
  }))
}

export async function upsertGroupRow(driver: SqlDriver, group: GroupRow): Promise<void> {
  const existing = await driver.get<{ n: number }>(
    'SELECT COUNT(*) AS n FROM plugin_groups WHERE name = ?',
    [group.name],
  )
  if ((existing?.n ?? 0) > 0) {
    await driver.run(
      'UPDATE plugin_groups SET description = ?, plugins_json = ?, profile = ?, created_at = ? WHERE name = ?',
      [group.description, JSON.stringify(group.plugins), group.profile, group.createdAt, group.name],
    )
    return
  }
  await driver.run(
    'INSERT INTO plugin_groups(name, description, plugins_json, profile, created_at) VALUES(?, ?, ?, ?, ?)',
    [group.name, group.description, JSON.stringify(group.plugins), group.profile, group.createdAt],
  )
}

export async function deleteGroupRow(driver: SqlDriver, name: string): Promise<boolean> {
  const result = await driver.run('DELETE FROM plugin_groups WHERE name = ?', [name])
  return result.changes > 0
}