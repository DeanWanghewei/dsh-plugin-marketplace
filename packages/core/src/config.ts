import { parse, stringify } from 'yaml'
import { builtinRegistryPath, dshmPaths, resolveDshmHome, type DshmPaths } from './paths.js'
import type { Runner } from './runner.js'

export interface RegistryRef {
  name: string
  type: 'file' | 'http' | 'git'
  /** file: absolute path to the registry document. */
  path?: string
  /** http: URL serving the document; git: repository URL. */
  url?: string
  /** http: bearer token. */
  token?: string
  /** git: branch, tag, or commit to pin. */
  ref?: string
  /** git: path of the registry document inside the repository. */
  subpath?: string
  disabled?: boolean
}

export interface DshmConfig {
  defaultProfile: string
  registries: RegistryRef[]
  /** https git tokens per host; never leaves this machine. */
  gitTokens: Record<string, string>
  /** Default sources the user explicitly removed; never re-added by migration. */
  removedDefaults?: string[]
}

/**
 * Curated default marketplace: a public git repository the maintainer keeps
 * with a hand-picked plugin list. Every install mounts it alongside the
 * bundled registry until the user removes it. `DSHM_CURATED_URL` overrides
 * for testing.
 */
export const CURATED_REGISTRY_URL = 'https://github.com/DeanWanghewei/dsh-plugin-registry.git'
export const CURATED_REGISTRY_NAME = 'curated'

export function curatedRegistryUrl(env: NodeJS.ProcessEnv): string {
  const override = env['DSHM_CURATED_URL']?.trim()
  if (override === 'none') return '' // explicit opt-out switch
  return override || CURATED_REGISTRY_URL
}

export function curatedRegistryRef(env: NodeJS.ProcessEnv): RegistryRef | undefined {
  const url = curatedRegistryUrl(env)
  if (!url) return undefined
  return {
    name: CURATED_REGISTRY_NAME,
    type: 'git',
    url,
    ref: 'main',
    subpath: 'registry.yaml',
  }
}

export function defaultRegistries(env: NodeJS.ProcessEnv = process.env): RegistryRef[] {
  const registries: RegistryRef[] = []
  const builtin = builtinRegistryPath()
  if (builtin) registries.push({ name: 'default', type: 'file', path: builtin })
  const curated = curatedRegistryRef(env)
  if (curated) registries.push(curated)
  return registries
}

export function defaultConfig(env: NodeJS.ProcessEnv = process.env): DshmConfig {
  return {
    defaultProfile: 'web',
    registries: defaultRegistries(env),
    gitTokens: {},
  }
}

export interface LoadedConfig {
  config: DshmConfig
  /** True when the file was missing and a default one was materialized. */
  created: boolean
  /** True when an existing file was migrated (curated default appended). */
  migrated: boolean
  paths: DshmPaths
}

export function loadConfig(runner: Runner, env: NodeJS.ProcessEnv): LoadedConfig {
  const home = resolveDshmHome(env)
  const paths = dshmPaths(home)
  const raw = runner.readTextFile(paths.configFile)
  if (raw === undefined) {
    const config = defaultConfig(env)
    if (config.registries.length > 0) {
      runner.writeTextFile(paths.configFile, stringify(config))
      runner.restrictPermissions(paths.configFile)
      return { config, created: true, migrated: false, paths }
    }
    return { config, created: false, migrated: false, paths }
  }
  const parsed = parse(raw) as Partial<DshmConfig> | undefined
  const config: DshmConfig = {
    defaultProfile: typeof parsed?.defaultProfile === 'string' ? parsed.defaultProfile : 'web',
    registries: Array.isArray(parsed?.registries) ? (parsed?.registries as RegistryRef[]) : [],
    gitTokens:
      parsed?.gitTokens && typeof parsed.gitTokens === 'object'
        ? (parsed.gitTokens as Record<string, string>)
        : {},
    removedDefaults: Array.isArray(parsed?.removedDefaults)
      ? (parsed?.removedDefaults as string[])
      : [],
  }
  // Migration: existing installs gain the curated default once it is
  // configured — unless the user removed it on purpose.
  const curated = curatedRegistryRef(env)
  let migrated = false
  if (
    curated &&
    !config.registries.some((ref) => ref.name === curated.name) &&
    !(config.removedDefaults ?? []).includes(curated.name)
  ) {
    config.registries.push(curated)
    migrated = true
  }
  if (migrated) {
    runner.writeTextFile(paths.configFile, stringify(config))
    runner.restrictPermissions(paths.configFile)
  }
  return { config, created: false, migrated, paths }
}

export function saveConfig(runner: Runner, paths: DshmPaths, config: DshmConfig): void {
  runner.writeTextFile(paths.configFile, stringify(config))
  runner.restrictPermissions(paths.configFile)
}
