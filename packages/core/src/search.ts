import type { CategoryDef, ResolvedPlugin } from './types.js'

export interface SearchQuery {
  text?: string
  /** OR semantics: a plugin matching any listed category passes. */
  categories?: string[]
  tag?: string
  registry?: string
}

export interface ScoredPlugin {
  plugin: ResolvedPlugin
  score: number
}

/**
 * Case-insensitive relevance scoring: each field contributes its best match
 * level, so a plugin matching on several fields outranks a single-field match.
 */
function textScore(haystacks: Array<{ value: string; weight: number }>, query: string): number {
  let total = 0
  const needle = query.toLowerCase()
  for (const { value, weight } of haystacks) {
    const lower = value.toLowerCase()
    if (lower === needle) total += weight * 2
    else if (lower.startsWith(needle)) total += weight
    else if (lower.includes(needle)) total += weight * 0.6
  }
  return total
}

export function searchPlugins(plugins: ResolvedPlugin[], query: SearchQuery): ScoredPlugin[] {
  const results: ScoredPlugin[] = []
  for (const plugin of plugins) {
    if (query.registry && plugin.registry !== query.registry) continue
    if (
      query.categories &&
      query.categories.length > 0 &&
      !query.categories.some((category) => plugin.entry.categories.includes(category))
    ) {
      continue
    }
    if (query.tag && !plugin.entry.tags.includes(query.tag)) continue
    let score = 1
    if (query.text) {
      score = textScore(
        [
          { value: plugin.entry.id, weight: 50 },
          { value: plugin.entry.name, weight: 30 },
          { value: plugin.qualifiedId, weight: 25 },
          { value: plugin.entry.tags.join(' '), weight: 10 },
          { value: plugin.entry.description, weight: 6 },
        ],
        query.text,
      )
      if (score === 0) continue
    }
    results.push({ plugin, score })
  }
  results.sort(
    (a, b) => b.score - a.score || a.plugin.qualifiedId.localeCompare(b.plugin.qualifiedId),
  )
  return results
}

export interface CategoryCount {
  category: CategoryDef
  count: number
}

export function categoryCounts(
  plugins: ResolvedPlugin[],
  categories: CategoryDef[],
): CategoryCount[] {
  const counts = new Map<string, number>()
  for (const plugin of plugins) {
    for (const categoryId of plugin.entry.categories) {
      counts.set(categoryId, (counts.get(categoryId) ?? 0) + 1)
    }
  }
  return categories.map((category) => ({
    category,
    count: counts.get(category.id) ?? 0,
  }))
}
