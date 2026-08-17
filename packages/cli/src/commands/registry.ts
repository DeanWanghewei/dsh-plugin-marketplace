import type { Command } from 'commander'
import { loadRegistries, saveConfig, type RegistryRef } from '@dshm/core'
import { createContext } from '../context.js'
import { pc, printTable } from '../output.js'

export function registerRegistryCommand(program: Command): void {
  const registry = program
    .command('registry')
    .description('manage registry sources (files, HTTP marketplaces, git repositories)')

  registry
    .command('list')
    .description('show configured registries and whether they load')
    .action(async () => {
      const context = createContext()
      const merged = await loadRegistries(context.runner, context.config, context.paths.cacheDir, {
        forceRefresh: true,
      })
      const rows = context.config.registries.map((ref) => {
        const error = merged.errors.find((entry) => entry.registry === ref.name)
        const loaded = merged.registries.find((entry) => entry.ref.name === ref.name)
        return [
          ref.name,
          ref.type,
          ref.path ?? `${ref.url ?? '—'}${ref.ref ? `#${ref.ref}` : ''}`,
          ref.disabled ? pc.yellow('disabled') : error ? pc.red(error.message) : pc.green('ok'),
          loaded ? String(loaded.data.plugins.length) : '—',
        ]
      })
      printTable(['NAME', 'TYPE', 'LOCATION', 'STATUS', 'PLUGINS'], rows)
    })

  registry
    .command('add')
    .description('add a registry source (local file, HTTP endpoint, or git repository)')
    .argument('<name>', 'registry name used in qualified ids (name:plugin)')
    .option('--file <path>', 'path to a registry.yaml file')
    .option('--url <url>', 'HTTP(S) endpoint serving a registry document')
    .option('--token <token>', 'bearer token for HTTP registries')
    .option('--git <url>', 'git repository containing a registry document')
    .option('--ref <ref>', 'git: branch, tag, or commit to pin')
    .option('--subpath <path>', 'git: document path inside the repository', 'registry.yaml')
    .action(
      async (
        name: string,
        flags: {
          file?: string
          url?: string
          token?: string
          git?: string
          ref?: string
          subpath?: string
        },
      ) => {
        const context = createContext()
        const chosen = [flags.file, flags.url, flags.git].filter(Boolean)
        if (chosen.length !== 1) {
          throw new Error('pass exactly one of --file, --url, or --git')
        }
        if (context.config.registries.some((entry) => entry.name === name)) {
          throw new Error(`registry '${name}' already exists`)
        }
        const ref: RegistryRef = flags.file
          ? { name, type: 'file', path: flags.file }
          : flags.git
            ? { name, type: 'git', url: flags.git, ref: flags.ref, subpath: flags.subpath }
            : { name, type: 'http', url: flags.url, token: flags.token }
        context.config.registries.push(ref)
        saveConfig(context.runner, context.paths, context.config)
        const merged = await loadRegistries(
          context.runner,
          context.config,
          context.paths.cacheDir,
          { forceRefresh: true },
        )
        const error = merged.errors.find((entry) => entry.registry === name)
        if (error) {
          console.error(pc.red(`added, but the registry failed to load: ${error.message}`))
          process.exitCode = 1
          return
        }
        console.log(pc.green(`added registry '${name}' (${merged.plugins.length} total plugins)`))
      },
    )

  registry
    .command('remove')
    .description('remove a registry source')
    .argument('<name>', 'registry name')
    .action((name: string) => {
      const context = createContext()
      const before = context.config.registries.length
      context.config.registries = context.config.registries.filter((ref) => ref.name !== name)
      if (context.config.registries.length === before) {
        throw new Error(`registry '${name}' not found`)
      }
      saveConfig(context.runner, context.paths, context.config)
      console.log(pc.green(`removed registry '${name}'`))
    })
}
