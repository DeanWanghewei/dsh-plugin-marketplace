import { join } from 'node:path'
import { parse } from 'yaml'
import type { DshmConfig, RegistryRef } from './config.js'
import { parseRegistry } from './schema.js'
import type { Runner } from './runner.js'
import { injectHttpsToken } from './spec.js'
import { qualifiedId, type CategoryDef, type RegistryData, type ResolvedPlugin } from './types.js'

export interface LoadedRegistry {
  ref: RegistryRef
  data: RegistryData
}

export interface RegistryWarning {
  registry: string
  message: string
}

export interface MergeResult {
  registries: LoadedRegistry[]
  errors: RegistryWarning[]
  warnings: RegistryWarning[]
  categories: CategoryDef[]
  plugins: ResolvedPlugin[]
}

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000

export interface LoadRegistriesOptions {
  cacheTtlMs?: number
  forceRefresh?: boolean
  nowMs?: () => number
}

interface CacheEnvelope {
  fetchedAt: number
  raw: string
}

export async function loadRegistries(
  runner: Runner,
  config: DshmConfig,
  cacheDir: string,
  options: LoadRegistriesOptions = {},
): Promise<MergeResult> {
  const errors: RegistryWarning[] = []
  const warnings: RegistryWarning[] = []
  const loaded: LoadedRegistry[] = []

  for (const ref of config.registries) {
    if (ref.disabled) continue
    try {
      const data = await loadOne(runner, ref, cacheDir, options, config.gitTokens)
      loaded.push({ ref, data })
    } catch (error) {
      errors.push({
        registry: ref.name,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const categories = new Map<string, CategoryDef>()
  const plugins = new Map<string, ResolvedPlugin>()
  for (const { ref, data } of loaded) {
    for (const category of data.categories) {
      if (!categories.has(category.id)) categories.set(category.id, category)
    }
    for (const entry of data.plugins) {
      const qualified = qualifiedId(ref.name, entry.id)
      if (plugins.has(qualified)) {
        warnings.push({ registry: ref.name, message: `duplicate plugin id '${entry.id}' skipped` })
        continue
      }
      plugins.set(qualified, { registry: ref.name, entry, qualifiedId: qualified })
    }
  }
  for (const plugin of plugins.values()) {
    for (const categoryId of plugin.entry.categories) {
      if (!categories.has(categoryId)) {
        warnings.push({
          registry: plugin.registry,
          message: `plugin '${plugin.entry.id}' references unknown category '${categoryId}'`,
        })
      }
    }
  }

  return {
    registries: loaded,
    errors,
    warnings,
    categories: [...categories.values()],
    plugins: [...plugins.values()],
  }
}

async function loadOne(
  runner: Runner,
  ref: RegistryRef,
  cacheDir: string,
  options: LoadRegistriesOptions,
  gitTokens: Record<string, string>,
): Promise<RegistryData> {
  if (ref.type === 'file') {
    return loadDocument(ref.name, runner.readTextFile(ref.path ?? ''))
  }
  if (ref.type === 'git') {
    return loadGitRegistry(runner, ref, cacheDir, options, gitTokens)
  }
  const url = ref.url ?? ''
  if (!url) throw new Error('http registry is missing url')
  const cacheFile = join(cacheDir, `${sanitize(ref.name)}.json`)
  const ttl = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
  const now = options.nowMs?.() ?? Date.now()
  const cached = runner.readTextFile(cacheFile)
  if (!options.forceRefresh && cached) {
    try {
      const envelope = JSON.parse(cached) as CacheEnvelope
      if (now - envelope.fetchedAt < ttl) {
        return loadDocument(ref.name, envelope.raw)
      }
    } catch {
      // Fall through to a fresh fetch when the cache is corrupt.
    }
  }
  const headers: Record<string, string> = {}
  if (ref.token) headers['authorization'] = `Bearer ${ref.token}`
  const response = await fetch(url, { headers })
  if (!response.ok) {
    throw new Error(`fetch ${url} failed: HTTP ${response.status}`)
  }
  const raw = await response.text()
  const data = loadDocument(ref.name, raw)
  runner.writeTextFile(cacheFile, JSON.stringify({ fetchedAt: now, raw } satisfies CacheEnvelope))
  return data
}

/**
 * A registry versioned in a git repository: cloned under the cache directory,
 * re-synced at most once per TTL, and — unlike http — a failed sync with an
 * existing clone degrades to the stale local copy instead of failing the
 * source, because the clone already holds the document.
 */
async function loadGitRegistry(
  runner: Runner,
  ref: RegistryRef,
  cacheDir: string,
  options: LoadRegistriesOptions,
  gitTokens: Record<string, string>,
): Promise<RegistryData> {
  if (!ref.url) throw new Error('git registry is missing url')
  // Token-injected URL only ever reaches the git command; error messages and
  // config keep the raw form so credentials never leak into output.
  const cloneUrl = injectHttpsToken(ref.url, gitTokens)
  const dir = join(cacheDir, 'git', sanitize(ref.name))
  const marker = join(dir, '.dshm-sync.json')
  const document = join(dir, ref.subpath ?? 'registry.yaml')
  const ttl = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
  const now = options.nowMs?.() ?? Date.now()
  const sync = async (): Promise<void> => {
    if (runner.exists(dir)) {
      const fetchOk =
        (await runner.run('git', ['fetch', 'origin'], { cwd: dir })).ok &&
        (ref.ref ? (await runner.run('git', ['checkout', ref.ref], { cwd: dir })).ok : true)
      if (!fetchOk) {
        if (runner.isFile(document)) return // stale local copy is still usable
        throw new Error(`git sync failed for ${ref.url}`)
      }
    } else {
      const clone = await runner.run('git', ['clone', cloneUrl, dir])
      if (!clone.ok) throw new Error(`git clone failed for ${ref.url}: ${clone.stderr.trim()}`)
      if (ref.ref) {
        const checkout = await runner.run('git', ['checkout', ref.ref], { cwd: dir })
        if (!checkout.ok) {
          throw new Error(`git checkout ${ref.ref} failed: ${checkout.stderr.trim()}`)
        }
      }
    }
    runner.writeTextFile(marker, JSON.stringify({ fetchedAt: now }))
  }
  const markerRaw = runner.readTextFile(marker)
  let fresh = false
  if (markerRaw) {
    try {
      fresh = now - (JSON.parse(markerRaw) as CacheEnvelope).fetchedAt < ttl
    } catch {
      fresh = false
    }
  }
  if (!options.forceRefresh && fresh) {
    return loadDocument(ref.name, runner.readTextFile(document))
  }
  await sync()
  return loadDocument(ref.name, runner.readTextFile(document))
}

function loadDocument(registryName: string, raw: string | undefined): RegistryData {
  if (raw === undefined) throw new Error('registry document is missing or unreadable')
  let parsed: unknown
  try {
    parsed = parse(raw)
  } catch (error) {
    throw new Error(`invalid YAML: ${error instanceof Error ? error.message : String(error)}`)
  }
  const result = parseRegistry(parsed as Record<string, unknown>)
  if (!result.ok) throw new Error(`schema validation failed: ${result.error}`)
  if (result.data.name !== registryName && registryName === 'default') {
    // The bundled registry may be re-hosted under another name; accept it.
    return result.data
  }
  return result.data
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_')
}
