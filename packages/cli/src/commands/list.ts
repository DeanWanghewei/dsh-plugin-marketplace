import type { Command } from 'commander'
import {
  installedView,
  loadRegistries,
  loadStore,
  directProfilePackages,
  uncatalogedPackages,
  type InstalledOrigin,
} from '@dshm/core'
import { createContext, resolveProfile } from '../context.js'
import { pc, printTable } from '../output.js'

export function registerListCommand(program: Command): void {
  program
    .command('list')
    .description('list marketplace plugins (default) or installed plugins (--installed)')
    .option('--installed', 'show what this profile (or all profiles) has installed')
    .option('--all-profiles', 'with --installed: scan every profile in the store')
    .action(async (flags: { installed?: boolean; allProfiles?: boolean }) => {
      const context = createContext()
      const merged = await loadRegistries(context.runner, context.config, context.paths.cacheDir)
      const profile = resolveProfile(context, program.opts()['profile'])

      if (flags.installed) {
        // Installed = dshm's own records ∪ what the profile's package.json
        // actually holds (in-box bundles and manually added plugins).
        const store = loadStore(context.runner, context.paths)
        const profiles = flags.allProfiles
          ? [...new Set([...Object.keys(store.profiles), profile])]
          : [profile]
        const rows: string[][] = []
        for (const name of profiles) {
          const view = installedView(
            context.runner,
            context.env,
            name,
            merged.plugins,
            store.profiles[name]?.plugins ?? [],
          )
          for (const [qualifiedId, origin] of [...view].sort(([a], [b]) => a.localeCompare(b))) {
            rows.push([
              name,
              qualifiedId,
              origin.kind === 'dshm' ? pc.cyan('dshm') : pc.yellow('profile'),
              origin.packageName ?? '—',
              origin.version ?? '—',
            ])
          }
        }
        for (const name of profiles) {
          // Packages the profile holds that no registry catalogs — still
          // installed, still manageable.
          for (const uncataloged of uncatalogedPackages(
            context.runner,
            directProfilePackages(context.runner, context.env, name),
            merged.plugins,
          )) {
            rows.push([
              name,
              `uncataloged:${uncataloged.packageName}`,
              pc.magenta('外部安装'),
              uncataloged.packageName,
              uncataloged.version,
            ])
          }
        }
        if (rows.length === 0) {
          console.log('nothing installed')
          return
        }
        printTable(['PROFILE', 'PLUGIN', 'VIA', 'PACKAGE', 'VERSION'], rows)
        return
      }

      const view: Map<string, InstalledOrigin> = installedView(
        context.runner,
        context.env,
        profile,
        merged.plugins,
        loadStore(context.runner, context.paths).profiles[profile]?.plugins ?? [],
      )
      printTable(
        ['ID', 'NAME', 'CATEGORIES', 'SOURCE', ''],
        merged.plugins.map((plugin) => [
          plugin.qualifiedId,
          plugin.entry.name,
          plugin.entry.categories.join(','),
          plugin.entry.source.type,
          view.has(plugin.qualifiedId) ? pc.green('✓ installed') : '',
        ]),
      )
    })
}
