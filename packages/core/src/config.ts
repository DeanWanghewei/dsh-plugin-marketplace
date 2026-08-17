import { parse, stringify } from 'yaml'
import { builtinRegistryPath, dshmPaths, resolveDshmHome, type DshmPaths } from './paths.js'
import type { Runner } from './runner.js'

export interface RegistryRef {
  name: string
  type: 'file' | 'http'
  path?: string
  url?: string
  token?: string
  disabled?: boolean
}

export interface DshmConfig {
  defaultProfile: string
  registries: RegistryRef[]
  /** https git tokens per host; never leaves this machine. */
  gitTokens: Record<string, string>
}

export function defaultRegistries(): RegistryRef[] {
  const builtin = builtinRegistryPath()
  if (!builtin) return []
  return [{ name: 'default', type: 'file', path: builtin }]
}

export function defaultConfig(): DshmConfig {
  return { defaultProfile: 'web', registries: defaultRegistries(), gitTokens: {} }
}

export interface LoadedConfig {
  config: DshmConfig
  /** True when the file was missing and a default one was materialized. */
  created: boolean
  paths: DshmPaths
}

export function loadConfig(runner: Runner, env: NodeJS.ProcessEnv): LoadedConfig {
  const home = resolveDshmHome(env)
  const paths = dshmPaths(home)
  const raw = runner.readTextFile(paths.configFile)
  if (raw === undefined) {
    const config = defaultConfig()
    if (config.registries.length > 0) {
      runner.writeTextFile(paths.configFile, stringify(config))
      runner.restrictPermissions(paths.configFile)
      return { config, created: true, paths }
    }
    return { config, created: false, paths }
  }
  const parsed = parse(raw) as Partial<DshmConfig> | undefined
  const config: DshmConfig = {
    defaultProfile: typeof parsed?.defaultProfile === 'string' ? parsed.defaultProfile : 'web',
    registries: Array.isArray(parsed?.registries) ? (parsed?.registries as RegistryRef[]) : [],
    gitTokens:
      parsed?.gitTokens && typeof parsed.gitTokens === 'object'
        ? (parsed.gitTokens as Record<string, string>)
        : {},
  }
  return { config, created: false, paths }
}

export function saveConfig(runner: Runner, paths: DshmPaths, config: DshmConfig): void {
  runner.writeTextFile(paths.configFile, stringify(config))
  runner.restrictPermissions(paths.configFile)
}
