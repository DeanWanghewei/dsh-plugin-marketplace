import type { PluginEntry } from './types.js'

/**
 * npm metadata scanner: turns a live npm scope into a registry source by
 * caching ONLY package metadata (name/description/version/license) — never
 * code. Official packages become visible the moment they publish, without
 * waiting for a dshm-cli release to refresh the bundled seed.
 *
 * Two registry endpoints, both unauthenticated:
 * - search:  GET /-/v1/search?text=<scope-prefix>&size=250  → package list
 * - manifest: GET /<name>/latest                             → single version's
 *   package.json fields (much smaller than the full packument)
 */

const NPM_REGISTRY = 'https://registry.npmjs.org'

interface SearchPackage {
  name: string
  version?: string
  description?: string
  date?: string
}

interface SearchResponse {
  objects: Array<{ package: SearchPackage }>
}

export interface NpmScanOptions {
  /** Scope prefix to scan, e.g. '@deepseek-ai/dsh'. */
  scope: string
  registry?: string
  /** Manifest fetches are capped; search caps at 250 anyway. */
  maxPackages?: number
  signal?: AbortSignal
}

interface LatestManifest {
  name?: string
  version?: string
  description?: string
  license?: string
  keywords?: string[]
  dependencies?: Record<string, string>
}

function idFromNpmName(name: string, scope: string): string {
  return name
    .replace(new RegExp(`^${scope.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), '')
    .replace(/^-/, '')
    .replace(/^dsh-/, '')
}

function categoriesFromName(name: string, manifest: LatestManifest): string[] {
  const categories = new Set<string>()
  const keywords = manifest.keywords ?? []
  if (keywords.includes('dsh-bundle') || name.includes('dsh-base')) categories.add('bundle')
  if (name.includes('dsh-tool') || keywords.includes('agent-tool')) categories.add('agent-tool')
  if (name.includes('ui') || name.includes('web') || name.includes('client')) categories.add('ui')
  if (keywords.includes('mcp')) categories.add('adapter')
  if (name.includes('sdk')) categories.add('sdk')
  if (categories.size === 0) categories.add('infrastructure')
  return [...categories]
}

/** Scan one scope: search + per-package latest manifest → PluginEntry list. */
export async function scanNpmScope(options: NpmScanOptions): Promise<PluginEntry[]> {
  const registry = options.registry ?? NPM_REGISTRY
  const max = options.maxPackages ?? 250
  const searchUrl = `${registry}/-/v1/search?text=${encodeURIComponent(options.scope)}&size=${max}`
  const searchResponse = await fetch(searchUrl, { signal: options.signal })
  if (!searchResponse.ok) {
    throw new Error(`npm search failed: HTTP ${searchResponse.status}`)
  }
  const search = (await searchResponse.json()) as SearchResponse
  const candidates = search.objects
    .map((entry) => entry.package)
    .filter((pkg) => pkg.name.startsWith(`${options.scope}`))
    .sort((a, b) => a.name.localeCompare(b.name))

  const entries: PluginEntry[] = []
  // Parallel manifest fetches in small batches to stay polite.
  for (let index = 0; index < candidates.length; index += 20) {
    const batch = candidates.slice(index, index + 20)
    const manifests = await Promise.all(
      batch.map(async (pkg) => {
        try {
          const response = await fetch(
            `${registry}/${encodeURIComponent(pkg.name).replace('%40', '@')}/latest`,
            { signal: options.signal },
          )
          return response.ok ? ((await response.json()) as LatestManifest) : undefined
        } catch {
          return undefined
        }
      }),
    )
    for (const [position, pkg] of batch.entries()) {
      const manifest = manifests[position]
      const id = idFromNpmName(pkg.name, options.scope)
      if (!id) continue // e.g. the scope's own root package
      entries.push({
        id,
        name: pkg.name,
        description: manifest?.description ?? pkg.description ?? '',
        categories: categoriesFromName(pkg.name, manifest ?? {}),
        tags: ['npm-live', ...(manifest?.keywords ?? []).slice(0, 3)],
        author: 'deepseek-ai',
        license: manifest?.license ?? 'MIT',
        verified: true,
        source: { type: 'npm', package: pkg.name },
        images: [],
        providesServices: [],
        requiresServices: [],
        requires: [],
      })
    }
  }
  return entries
}

/** @internal test export */
export const idFromNpmNameForTest = idFromNpmName
