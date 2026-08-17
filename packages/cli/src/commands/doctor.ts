import type { Command } from 'commander'
import { builtinRegistryPath, detectEnvironment, loadRegistries, loadStore } from '@dshm/core'
import { createContext, resolveProfile } from '../context.js'
import { pc } from '../output.js'

function mark(ok: boolean): string {
  return ok ? pc.green('✓') : pc.red('✗')
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('check dsh/pnpm availability, profile state, and registry health')
    .action(async () => {
      const context = createContext()
      const profile = resolveProfile(context, program.opts()['profile'])
      const environment = await detectEnvironment(context.runner, context.env, profile)
      let healthy = true

      console.log(mark(environment.dshFound), 'dsh', environment.dshVersion ?? 'not found on PATH')
      console.log(
        mark(environment.pnpmFound),
        'pnpm',
        environment.pnpmVersion ?? 'not found on PATH',
      )
      if (!environment.dshFound || !environment.pnpmFound) healthy = false

      console.log(
        mark(environment.dshHomeExists),
        `DSH_HOME ${environment.dshHome}`,
        environment.dshHomeExists ? '' : '(missing — dsh creates it on first boot)',
      )
      console.log(
        environment.profileExists ? mark(true) : pc.yellow('!'),
        `profile '${profile}' → ${environment.profileDir}`,
        environment.profileExists ? '' : '(auto-initialized on first install)',
      )
      console.log(
        mark(builtinRegistryPath() !== undefined),
        `builtin registry ${builtinRegistryPath() ?? 'not found'}`,
      )

      const merged = await loadRegistries(context.runner, context.config, context.paths.cacheDir, {
        forceRefresh: true,
      })
      for (const { ref } of merged.registries) {
        console.log(mark(true), `registry '${ref.name}' loaded`)
      }
      for (const error of merged.errors) {
        healthy = false
        console.log(mark(false), `registry '${error.registry}': ${error.message}`)
      }

      const store = loadStore(context.runner, context.paths)
      for (const [profileName, pending] of Object.entries(store.pending)) {
        healthy = false
        console.log(
          pc.yellow('!'),
          `profile '${profileName}' has an interrupted install of ${pending.pluginId}` +
            ` (started ${pending.startedAt}); re-run install or uninstall to settle it`,
        )
      }

      console.log(healthy ? pc.green('all checks passed') : pc.yellow('issues found — see above'))
      if (!healthy) process.exitCode = 1
    })
}
