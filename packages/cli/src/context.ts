import {
  loadConfig,
  loadRegistries,
  NodeRunner,
  type DshmConfig,
  type DshmPaths,
  type MergeResult,
  type ResolvedPlugin,
} from '@dshm/core'

export interface CliContext {
  runner: NodeRunner
  env: NodeJS.ProcessEnv
  config: DshmConfig
  paths: DshmPaths
}

export function createContext(env: NodeJS.ProcessEnv = process.env): CliContext {
  const runner = new NodeRunner()
  const { config, paths } = loadConfig(runner, env)
  return { runner, env, config, paths }
}

export async function loadMerged(context: CliContext): Promise<MergeResult> {
  return loadRegistries(context.runner, context.config, context.paths.cacheDir)
}

export function resolveProfile(context: CliContext, override?: string): string {
  return override ?? context.config.defaultProfile
}

/**
 * Resolve one plugin by qualified id (`registry:id`) or by bare id when the
 * suffix matches exactly one plugin across all registries.
 */
export function resolvePluginById(
  merged: MergeResult,
  id: string,
): { plugin: ResolvedPlugin } | { error: string } {
  const exact = merged.plugins.find((plugin) => plugin.qualifiedId === id)
  if (exact) return { plugin: exact }
  const suffixMatches = merged.plugins.filter((plugin) => plugin.entry.id === id)
  if (suffixMatches.length === 1) {
    return { plugin: suffixMatches[0]! }
  }
  if (suffixMatches.length > 1) {
    const candidates = suffixMatches.map((plugin) => plugin.qualifiedId).join(', ')
    return { error: `'${id}' is ambiguous across registries: ${candidates}` }
  }
  return { error: `no plugin '${id}' found; try \`dshm search\`` }
}
