import type { Command } from 'commander'
import { runLocalConsole } from '../localserver.js'

export function registerWebCommand(program: Command): void {
  program
    .command('web')
    .description('open the local web console (all marketplaces, random port, exits on Ctrl+C)')
    .action(async () => {
      await runLocalConsole(process.env)
    })
}
