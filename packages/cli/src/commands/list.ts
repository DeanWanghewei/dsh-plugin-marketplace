import type { Command } from 'commander'
import { listInstalled, loadStore } from '@dshm/core'
import { createContext, loadMerged, resolveProfile } from '../context.js'
import { pc, printTable } from '../output.js'

export function registerListCommand(program: Command): void {
  program
    .command('list')
    .description('list marketplace plugins (default) or installed plugins (--installed)')
    .option('--installed', 'show what this profile (or all profiles) has installed')
    .option('--all-profiles', 'with --installed: scan every profile in the store')
    .action(async (flags: { installed?: boolean; allProfiles?: boolean }) => {
      const context = createContext()
      if (flags.installed) {
        const store = loadStore(context.runner, context.paths)
        const rows: string[][] = []
        if (flags.allProfiles) {
          for (const [profile, { plugins }] of Object.entries(store.profiles)) {
            for (const record of plugins) {
              rows.push([profile, record.pluginId, record.strategy, record.packageName ?? '—'])
            }
          }
        } else {
          const profile = resolveProfile(context, program.opts()['profile'])
          for (const record of listInstalled(store, profile)) {
            rows.push([profile, record.pluginId, record.strategy, record.packageName ?? '—'])
          }
        }
        if (rows.length === 0) {
          console.log('nothing installed')
          return
        }
        printTable(['PROFILE', 'PLUGIN', 'STRATEGY', 'PACKAGE'], rows)
        return
      }

      const merged = await loadMerged(context)
      const profile = resolveProfile(context, program.opts()['profile'])
      const installed = new Set(
        listInstalled(loadStore(context.runner, context.paths), profile).map(
          (record) => record.pluginId,
        ),
      )
      printTable(
        ['ID', 'NAME', 'CATEGORIES', 'SOURCE', ''],
        merged.plugins.map((plugin) => [
          plugin.qualifiedId,
          plugin.entry.name,
          plugin.entry.categories.join(','),
          plugin.entry.source.type,
          installed.has(plugin.qualifiedId) ? pc.green('✓ installed') : '',
        ]),
      )
    })
}
