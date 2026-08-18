import type { Command } from 'commander'
import { loadStore, type PluginSource } from '@dshm/core'
import { createContext, loadMerged, resolvePluginById } from '../context.js'
import { pc } from '../output.js'

function describeSource(source: PluginSource): string {
  if (source.type === 'npm') {
    return `npm ${source.package}`
  }
  if (source.type === 'git') {
    const where = [source.url, source.ref, source.subdir].filter(Boolean).join(' ')
    return `git ${where}${source.private ? ' (private)' : ''}`
  }
  return `path ${source.path}${source.link ? ' (link)' : ''}`
}

export function registerInfoCommand(program: Command): void {
  program
    .command('info')
    .description('show one plugin in detail')
    .argument('<id>', 'plugin id (`registry:id` or bare id)')
    .action(async (id: string) => {
      const context = createContext()
      const merged = await loadMerged(context)
      const resolved = resolvePluginById(merged, id)
      if ('error' in resolved) throw new Error(resolved.error)
      const { entry } = resolved.plugin

      const lines = [
        `${pc.bold(entry.name)}  ${pc.dim(resolved.plugin.qualifiedId)}`,
        entry.description || pc.dim('(no description)'),
        `source:    ${describeSource(entry.source)}`,
        `categories:${entry.categories.length > 0 ? ` ${entry.categories.join(', ')}` : ' —'}`,
      ]
      if (entry.tags.length > 0) lines.push(`tags:      ${entry.tags.join(', ')}`)
      if ((entry.requires?.length ?? 0) > 0) {
        lines.push(`requires: ${entry.requires!.join(', ')}  ${pc.dim('(依赖插件，建议一并安装)')}`)
      }
      if ((entry.requiresServices?.length ?? 0) > 0) {
        lines.push(`injects:  ${entry.requiresServices!.join(', ')}  ${pc.dim('(所需 ctx 服务)')}`)
      }
      const meta = [
        entry.author && `author: ${entry.author}`,
        entry.license && `license: ${entry.license}`,
        entry.homepage && `homepage: ${entry.homepage}`,
        entry.verified ? pc.green('verified') : pc.yellow('unverified'),
      ].filter(Boolean)
      lines.push(meta.join('  ·  '))

      const store = loadStore(context.runner, context.paths)
      const installedSomewhere = Object.entries(store.profiles)
        .flatMap(([profile, { plugins }]) =>
          plugins
            .filter((record) => record.pluginId === resolved.plugin.qualifiedId)
            .map((record) => ({ profile, record })),
        )
        .map(
          ({ profile, record }) =>
            `installed: ${profile} (${record.strategy}, ${record.version.version ?? record.version.spec})`,
        )
      lines.push(
        ...(installedSomewhere.length > 0 ? installedSomewhere : [pc.dim('installed: nowhere')]),
      )

      console.log(lines.join('\n'))
    })
}

// Re-exported for list.ts reuse.
export { describeSource }
