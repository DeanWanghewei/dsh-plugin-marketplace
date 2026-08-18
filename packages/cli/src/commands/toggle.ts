import type { Command } from 'commander'
import { disablePlugin, enablePlugin } from '@dshm/core'
import { createContext, resolveProfile } from '../context.js'
import { pc } from '../output.js'

export function registerToggleCommands(program: Command): void {
  program
    .command('enable')
    .description('enable a dshm-installed plugin (adds/removes the disabled flag on its row)')
    .argument('<id>', 'plugin id')
    .option('--profile <name>', 'target profile')
    .option('--config <yaml>', 'inline row config for config-required plugins (YAML object)')
    .action(async (id: string, flags: { profile?: string; config?: string }) => {
      const context = createContext()
      const profile = resolveProfile(context, flags.profile ?? program.opts()['profile'])
      const outcome = await enablePlugin(
        { runner: context.runner, env: context.env, config: context.config, paths: context.paths },
        id,
        profile,
        flags.config,
      )
      if (outcome.status === 'config-required') {
        console.error(pc.yellow(outcome.message))
        process.exitCode = 1
        return
      }
      if (outcome.status === 'not-managed') throw new Error(outcome.message)
      console.log(pc.green(`enabled ${id} in profile '${profile}'`))
      for (const hint of outcome.hints) console.log(pc.dim(`- ${hint}`))
    })

  program
    .command('disable')
    .description('disable a dshm-installed plugin without uninstalling it')
    .argument('<id>', 'plugin id')
    .option('--profile <name>', 'target profile')
    .action(async (id: string, flags: { profile?: string }) => {
      const context = createContext()
      const profile = resolveProfile(context, flags.profile ?? program.opts()['profile'])
      const outcome = await disablePlugin(
        { runner: context.runner, env: context.env, config: context.config, paths: context.paths },
        id,
        profile,
      )
      if (outcome.status === 'not-managed') throw new Error(outcome.message)
      if (outcome.status !== 'disabled') return
      console.log(pc.yellow(`disabled ${id} in profile '${profile}'`))
      for (const hint of outcome.hints) console.log(pc.dim(`- ${hint}`))
    })
}
