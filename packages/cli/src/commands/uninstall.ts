import type { Command } from 'commander'
import { uninstallPlugin } from '@dshm/core'
import { createContext, resolveProfile } from '../context.js'
import { pc } from '../output.js'

export function registerUninstallCommand(program: Command): void {
  program
    .command('uninstall')
    .description('remove an installed plugin from a dsh profile')
    .argument('<id>', 'plugin id (`registry:id` or bare id)')
    .action(async (id: string) => {
      const context = createContext()
      const profile = resolveProfile(context, program.opts()['profile'])
      const outcome = await uninstallPlugin(
        { runner: context.runner, env: context.env, config: context.config, paths: context.paths },
        id,
        profile,
      )
      if (outcome.status === 'not-installed') {
        console.log(pc.yellow(`'${id}' is not installed in profile '${profile}'`))
        return
      }
      if (outcome.status === 'error') throw new Error(outcome.message)
      console.log(pc.green(`uninstalled ${id} from profile '${profile}'`))
      for (const hint of outcome.hints) console.log(pc.dim(`- ${hint}`))
    })
}
