/** Bilingual label; at least one language is present. */
export interface LocalizedText {
  zh?: string
  en?: string
}

/** One category in a registry taxonomy. A plugin may reference several (many-to-many). */
export interface CategoryDef {
  id: string
  name: LocalizedText
  parent: string | null
  description?: string
}

/** Discriminated union describing where a plugin's code comes from. */
export type PluginSource =
  | { type: 'npm'; package: string }
  | { type: 'git'; url: string; ref?: string; subdir?: string; private?: boolean }
  | { type: 'path'; path: string; link?: boolean }

export interface PluginEntry {
  id: string
  name: string
  description: string
  categories: string[]
  tags: string[]
  author?: string
  homepage?: string
  license?: string
  verified: boolean
  source: PluginSource
}

export interface RegistryData {
  schemaVersion: 1
  name: string
  categories: CategoryDef[]
  plugins: PluginEntry[]
}

/** A plugin resolved against the registry it came from. */
export interface ResolvedPlugin {
  registry: string
  entry: PluginEntry
  qualifiedId: string
}

export function qualifiedId(registry: string, id: string): string {
  return `${registry}:${id}`
}

/** Strategy used to install one plugin into a profile. */
export type InstallStrategy = 'pnpm' | 'managed-row'

/** How the installed plugin is pinned, per source type. */
export interface InstalledVersion {
  spec: string
  version?: string
  ref?: string
}

export interface StoreRecord {
  pluginId: string
  registry: string
  entryName: string
  installedAt: string
  strategy: InstallStrategy
  version: InstalledVersion
  /** For managed-row installs: the patch row id and copied entry file. */
  managed?: { rowId: string; entryRelPath: string }
  /** For pnpm installs: the dependency name written to the profile manifest. */
  packageName?: string
}

export interface StoreFile {
  schemaVersion: 1
  profiles: Record<string, { plugins: StoreRecord[] }>
  pending: Record<string, { pluginId: string; strategy: InstallStrategy; startedAt: string }>
}
