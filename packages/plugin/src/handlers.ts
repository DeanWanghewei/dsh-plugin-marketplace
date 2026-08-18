import {
  installedView,
  listInstalled,
  loadConfig,
  loadRegistries,
  loadStore,
  NodeRunner,
  resolveDshHome,
  searchPlugins,
  installPlugin,
  uninstallPlugin,
  dshmPaths,
  type InstallerDeps,
  type ResolvedPlugin,
} from '@dshm/core'

/**
 * Pure tool handlers: everything the model-facing tools do, without the
 * harness tool DSL — so the logic stays unit-testable with a FakeRunner.
 * Each handler returns model-facing text.
 */

function describeSource(source: ResolvedPlugin['entry']['source']): string {
  if (source.type === 'npm') return `npm ${source.package}`
  if (source.type === 'git') {
    return `git ${source.url}${source.ref ? `#${source.ref}` : ''}${source.private ? ' (private)' : ''}`
  }
  return `path ${source.path}`
}

export async function handleSearch(input: {
  query?: string
  category?: string
  tag?: string
  registry?: string
  limit?: number
}): Promise<string> {
  const runner = new NodeRunner()
  const { config, paths } = loadConfig(runner, process.env)
  const merged = await loadRegistries(runner, config, paths.cacheDir)
  for (const error of merged.errors) {
    // Surface but do not fail: other sources still answer.
    return `registry '${error.registry}' failed: ${error.message} (try again or run \`dshm doctor\` on the host)`
  }
  const results = searchPlugins(merged.plugins, {
    text: input.query,
    categories: input.category ? input.category.split(',').map((entry) => entry.trim()) : undefined,
    tag: input.tag,
    registry: input.registry,
  })
  if (results.length === 0) return 'no plugins matched'
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50)
  const lines = results.slice(0, limit).map(({ plugin }) => {
    const badges = [plugin.entry.verified ? 'verified' : 'unverified']
    return `${plugin.qualifiedId} — ${plugin.entry.name} [${plugin.entry.categories.join(',') || 'no category'}] (${describeSource(plugin.entry.source)}, ${badges.join(', ')})`
  })
  const suffix = results.length > limit ? `\n… ${results.length - limit} more` : ''
  return `${results.length} plugins:\n${lines.join('\n')}${suffix}`
}

export async function handleInfo(id: string, profile?: string): Promise<string> {
  const runner = new NodeRunner()
  const { config, paths } = loadConfig(runner, process.env)
  const merged = await loadRegistries(runner, config, paths.cacheDir)
  const plugin = merged.plugins.find(
    (entry) => entry.qualifiedId === id || entry.entry.id === id,
  )
  if (!plugin) return `plugin '${id}' not found`
  const targetProfile = profile ?? config.defaultProfile
  const view = installedView(
    runner,
    process.env,
    targetProfile,
    merged.plugins,
    listInstalled(loadStore(runner, paths), targetProfile),
  )
  const origin = view.get(plugin.qualifiedId)
  const lines = [
    `${plugin.entry.name} (${plugin.qualifiedId})`,
    plugin.entry.description || '(no description)',
    `source: ${describeSource(plugin.entry.source)}`,
    ...(plugin.entry.requires?.length
      ? [`requires: ${plugin.entry.requires.join(', ')}`]
      : []),
    ...(plugin.entry.requiresServices?.length
      ? [`injects services: ${plugin.entry.requiresServices.join(', ')}`]
      : []),
    `categories: ${plugin.entry.categories.join(', ') || '—'}`,
    plugin.entry.verified ? 'verified' : 'unverified',
    `installed in '${targetProfile}': ${
      origin
        ? `yes (${origin.kind === 'dshm' ? 'via dshm' : 'already in profile'}, ${origin.version ?? ''})`
        : 'no'
    }`,
    `install command: dshm install ${plugin.entry.id}`,
  ]
  return lines.join('\n')
}

export async function handleListInstalled(profile?: string): Promise<string> {
  const runner = new NodeRunner()
  const { config, paths } = loadConfig(runner, process.env)
  const targetProfile = profile ?? config.defaultProfile
  const merged = await loadRegistries(runner, config, paths.cacheDir)
  const view = installedView(
    runner,
    process.env,
    targetProfile,
    merged.plugins,
    listInstalled(loadStore(runner, paths), targetProfile),
  )
  if (view.size === 0) return `nothing installed in profile '${targetProfile}'`
  const lines = [...view]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([qualifiedId, origin]) => `${qualifiedId} (${origin.kind}${origin.version ? `, ${origin.version}` : ''})`)
  return `profile '${targetProfile}' (${view.size} installed):\n${lines.join('\n')}`
}

export async function handleInstall(
  id: string,
  options: { profile?: string; allowBuild?: boolean } = {},
): Promise<string> {
  const runner = new NodeRunner()
  const { config, paths } = loadConfig(runner, process.env)
  const deps: InstallerDeps = { runner, env: process.env, config, paths }
  const merged = await loadRegistries(runner, config, paths.cacheDir)
  const resolved = merged.plugins.find(
    (entry) => entry.qualifiedId === id || entry.entry.id === id,
  )
  if (!resolved) return `plugin '${id}' not found`
  const profile = options.profile ?? config.defaultProfile
  try {
    const outcome = await installPlugin(deps, resolved, {
      profile,
      allowBuild: options.allowBuild === true,
    })
    if (outcome.status === 'already-installed') {
      return `already installed in '${profile}' (${outcome.record.strategy})`
    }
    if (outcome.status === 'allow-builds-required') {
      return [
        `pnpm requires build-script permission for: ${outcome.keys.join(', ')}.`,
        'Granting means this package code runs on the machine at install time —',
        'ask the user, then retry with allow_build=true.',
      ].join(' ')
    }
    const warnings = outcome.warnings.length > 0 ? `\nwarnings: ${outcome.warnings.join('; ')}` : ''
    const hints = outcome.hints.map((hint) => `\n- ${hint}`).join('')
    return `installed ${outcome.record.pluginId} into '${profile}' (${outcome.record.strategy})${warnings}${hints}`
  } catch (error) {
    return `install failed: ${error instanceof Error ? error.message : String(error)}`
  }
}

export async function handleUninstall(id: string, profile?: string): Promise<string> {
  const runner = new NodeRunner()
  const { config, paths } = loadConfig(runner, process.env)
  const deps: InstallerDeps = { runner, env: process.env, config, paths }
  const targetProfile = profile ?? config.defaultProfile
  const outcome = await uninstallPlugin(deps, id, targetProfile)
  if (outcome.status === 'not-installed') {
    return `'${id}' is not installed in profile '${targetProfile}' (dshm only manages plugins it installed)`
  }
  if (outcome.status === 'error') return `uninstall failed: ${outcome.message}`
  return `uninstalled ${id} from '${targetProfile}'${outcome.hints.map((hint) => `\n- ${hint}`).join('')}`
}

/** Helper re-export so tests can exercise path resolution the same way. */
export { dshmPaths, resolveDshHome }
