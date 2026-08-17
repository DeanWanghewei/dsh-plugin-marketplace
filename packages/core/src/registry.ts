import { join } from 'node:path'
import { parse } from 'yaml'
import type { DshmConfig, RegistryRef } from './config.js'
import { parseRegistry } from './schema.js'
import type { Runner } from './runner.js'
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
      const data = await loadOne(runner, ref, cacheDir, options)
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
): Promise<RegistryData> {
  if (ref.type === 'file') {
    return loadDocument(ref.name, runner.readTextFile(ref.path ?? ''))
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
