import type { Command } from 'commander'
import { installPlugin, type InstallOptions } from '@dshm/core'
import { createContext, loadMerged, resolvePluginById, resolveProfile } from '../context.js'
import { pc } from '../output.js'
import { describeSource } from './info.js'
import { confirm } from '../prompt.js'

export function registerInstallCommand(program: Command): void {
  program
    .command('install')
    .description('install a plugin into a dsh profile')
    .argument('<id>', 'plugin id (`registry:id` or bare id)')
    .option('--ref <ref>', 'override source ref: npm version, git branch/tag/sha')
    .option('--link', 'path sources install as pnpm link: (live editing)')
    .option('--allow-build', 'grant pnpm allowBuilds for this package and retry')
    .option('-y, --yes', 'skip confirmation prompts')
    .action(
      async (
        id: string,
        flags: { ref?: string; link?: boolean; allowBuild?: boolean; yes?: boolean },
      ) => {
        const context = createContext()
        const merged = await loadMerged(context)
        const resolved = resolvePluginById(merged, id)
        if ('error' in resolved) throw new Error(resolved.error)
        const { entry } = resolved.plugin
        const profile = resolveProfile(context, program.opts()['profile'])

        console.log(
          [
            `${pc.bold(entry.name)} → profile '${profile}'`,
            `  source: ${describeSource(entry.source)}`,
            entry.description && `  ${entry.description}`,
            `  ${entry.verified ? pc.green('✓ verified') : pc.yellow('! unverified')}`,
          ]
            .filter(Boolean)
            .join('\n'),
        )

        const needsConfirm = entry.source.type === 'git'
        if (needsConfirm && !flags.yes) {
          const proceed = await confirm(
            'git installs run the package build scripts on this machine; continue?',
          )
          if (!proceed) {
            console.log('aborted')
            return
          }
        }

        const options: InstallOptions = {
          profile,
          ref: flags.ref,
          link: flags.link,
          allowBuild: flags.allowBuild,
        }
        const outcome = await runInstall(context, resolved.plugin.qualifiedId, options)
        if (outcome === 'retry-with-allow-build') {
          const grant = flags.yes || (await confirm('allow these build scripts now?'))
          if (!grant) {
            console.log(pc.yellow('aborted — re-run with --allow-build to grant'))
            return
          }
          await runInstall(context, resolved.plugin.qualifiedId, { ...options, allowBuild: true })
        }
      },
    )

  async function runInstall(
    context: ReturnType<typeof createContext>,
    qualifiedId: string,
    options: InstallOptions,
  ): Promise<'done' | 'retry-with-allow-build'> {
    const merged = await loadMerged(context)
    const resolved = resolvePluginById(merged, qualifiedId)
    if ('error' in resolved) throw new Error(resolved.error)
    const outcome = await installPlugin(
      { runner: context.runner, env: context.env, config: context.config, paths: context.paths },
      resolved.plugin,
      options,
    )
    if (outcome.status === 'already-installed') {
      console.log(pc.yellow(`already installed (${outcome.record.strategy})`))
      return 'done'
    }
    if (outcome.status === 'allow-builds-required') {
      console.log(
        pc.yellow(
          `\npnpm refused to run build scripts for: ${outcome.keys.join(', ')}\n` +
            'granting this means the package code runs on your machine at install time.',
        ),
      )
      return 'retry-with-allow-build'
    }
    for (const warning of outcome.warnings) console.warn(pc.yellow(warning))
    console.log(pc.green(`installed ${outcome.record.pluginId} (${outcome.record.strategy})`))
    for (const hint of outcome.hints) console.log(pc.dim(`- ${hint}`))
    return 'done'
  }
}
