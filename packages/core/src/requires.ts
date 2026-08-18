import type { PluginEntry, ResolvedPlugin } from './types.js'

/** Dependency-graph helpers over the optional requires metadata. */

/**
 * Provider map: ctx service key → plugin ids that provide it. Built by the
 * seed script from harness sources (`super(ctx, 'name')` declarations).
 */
export type ServiceProviders = Map<string, string[]>

/** Plugins whose presence satisfies this entry's requires/requiresServices. */
export function dependencyIds(entry: PluginEntry, providers?: ServiceProviders): string[] {
  const ids = new Set<string>()
  for (const required of entry.requires ?? []) ids.add(required)
  if (providers) {
    for (const service of entry.requiresServices ?? []) {
      for (const provider of providers.get(service) ?? []) {
        if (provider !== entry.id) ids.add(provider)
      }
    }
  }
  ids.delete(entry.id)
  return [...ids]
}

export interface DependencyGap {
  /** Plugin id that is required but not installed. */
  id: string
  /** Where the requirement came from. */
  via: 'requires' | `service:${string}`
}

/**
 * Required plugins not present in a profile. `installedQualifiedIds` carries
 * the installed view; ids resolve within the same registry first.
 */
export function missingDependencies(
  plugin: ResolvedPlugin,
  installedQualifiedIds: Set<string>,
  allPlugins: ResolvedPlugin[],
): DependencyGap[] {
  const gaps: DependencyGap[] = []
  const sameRegistry = allPlugins.filter((entry) => entry.registry === plugin.registry)
  const installed = (id: string): boolean => {
    const target =
      sameRegistry.find((entry) => entry.entry.id === id) ??
      allPlugins.find((entry) => entry.entry.id === id)
    if (!target) return false
    return installedQualifiedIds.has(target.qualifiedId)
  }
  for (const id of plugin.entry.requires ?? []) {
    if (!installed(id)) gaps.push({ id, via: 'requires' })
  }
  const seen = new Set(gaps.map((gap) => gap.id))
  for (const service of plugin.entry.requiresServices ?? []) {
    const providers = allPlugins.filter(
      (entry) =>
        (entry.entry.providesServices ?? []).includes(service) && entry.entry.id !== plugin.entry.id,
    )
    if (providers.length === 0) continue // framework service (tools, llm, …)
    if (!providers.some((provider) => installedQualifiedIds.has(provider.qualifiedId))) {
      const id = providers[0]!.entry.id
      if (seen.has(id)) continue // already reported via `requires`
      seen.add(id)
      gaps.push({ id, via: `service:${service}` })
    }
  }
  return gaps
}
