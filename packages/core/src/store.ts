import type { DshmPaths } from './paths.js'
import type { Runner } from './runner.js'
import type { InstallStrategy, StoreFile, StoreRecord } from './types.js'

function emptyStore(): StoreFile {
  return { schemaVersion: 1, profiles: {}, pending: {} }
}

/**
 * Two-phase install journal: `setPending` before any mutation, `commit`/`abort`
 * after. A leftover pending row on load marks an interrupted install that
 * `dshm doctor` can surface and `uninstall` can clean up.
 */
export function loadStore(runner: Runner, paths: DshmPaths): StoreFile {
  const raw = runner.readTextFile(paths.storeFile)
  if (raw === undefined) return emptyStore()
  try {
    const parsed = JSON.parse(raw) as Partial<StoreFile>
    if (parsed.schemaVersion !== 1) return emptyStore()
    return {
      schemaVersion: 1,
      profiles: parsed.profiles ?? {},
      pending: parsed.pending ?? {},
    }
  } catch {
    return emptyStore()
  }
}

export function saveStore(runner: Runner, paths: DshmPaths, store: StoreFile): void {
  const tmp = `${paths.storeFile}.tmp`
  runner.writeTextFile(tmp, `${JSON.stringify(store, null, 2)}\n`)
  runner.rename(tmp, paths.storeFile)
}

export function setPending(
  store: StoreFile,
  profile: string,
  pluginId: string,
  strategy: InstallStrategy,
  nowIso: string,
): StoreFile {
  return {
    ...store,
    pending: { ...store.pending, [profile]: { pluginId, strategy, startedAt: nowIso } },
  }
}

export function clearPending(store: StoreFile, profile: string): StoreFile {
  const pending = { ...store.pending }
  delete pending[profile]
  return { ...store, pending }
}

export function addInstalled(store: StoreFile, profile: string, record: StoreRecord): StoreFile {
  const existing = store.profiles[profile] ?? { plugins: [] }
  const plugins = existing.plugins.filter((item) => item.pluginId !== record.pluginId)
  plugins.push(record)
  const next: StoreFile = {
    ...store,
    profiles: { ...store.profiles, [profile]: { plugins } },
  }
  return clearPending(next, profile)
}

export function removeInstalled(store: StoreFile, profile: string, pluginId: string): StoreFile {
  const existing = store.profiles[profile]
  if (!existing) return clearPending(store, profile)
  const plugins = existing.plugins.filter((item) => item.pluginId !== pluginId)
  const next: StoreFile = {
    ...store,
    profiles: { ...store.profiles, [profile]: { plugins } },
  }
  return clearPending(next, profile)
}

export function listInstalled(store: StoreFile, profile: string): StoreRecord[] {
  return store.profiles[profile]?.plugins ?? []
}

/** Match by qualified id (`registry:id`) or by bare id when unambiguous. */
export function findInstalled(
  store: StoreFile,
  profile: string,
  pluginId: string,
): StoreRecord | undefined {
  const installed = listInstalled(store, profile)
  return (
    installed.find((item) => item.pluginId === pluginId) ??
    installed.find((item) => item.pluginId.endsWith(`:${pluginId}`))
  )
}
