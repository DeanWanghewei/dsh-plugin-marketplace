import { writeFileSync } from 'node:fs'
import type { Command } from 'commander'
import {
  exportGroupYaml,
  findGroup,
  importGroupYaml,
  installGroup,
  loadGroups,
  removeGroup,
  upsertGroup,
  type PluginGroup,
} from '@dshm/core'
import { createContext, loadMerged, resolveProfile } from '../context.js'
import { pc, printTable } from '../output.js'

export function registerGroupCommand(program: Command): void {
  const group = program
    .command('group')
    .description('plugin groups — capture, share, and replay plugin sets')

  group
    .command('save')
    .description('capture a group: selected plugin ids, or the profile\'s dshm installs')
    .argument('<name>', 'group name')
    .argument('[ids...]', 'plugin ids to include (default: all dshm installs in the profile)')
    .option('--profile <name>', 'profile to capture from when no ids given')
    .option('--description <text>', 'what this group is for')
    .action(async (name: string, ids: string[], flags: { profile?: string; description?: string }) => {
      const context = createContext()
      const profile = resolveProfile(context, flags.profile ?? program.opts()['profile'])
      let plugins = ids
      if (plugins.length === 0) {
        const { installedView, listInstalled, loadStore } = await import('@dshm/core')
        const merged = await loadMerged(context)
        const view = installedView(
          context.runner,
          context.env,
          profile,
          merged.plugins,
          listInstalled(loadStore(context.runner, context.paths), profile),
        )
        plugins = [...view.keys()]
        if (plugins.length === 0) {
          console.error(pc.yellow(`profile '${profile}' 没有 dshm 安装的插件；传入 id 列表或先安装`))
          process.exitCode = 1
          return
        }
      }
      const entry: PluginGroup = {
        name,
        description: flags.description ?? '',
        plugins,
        profile,
        createdAt: new Date().toISOString(),
      }
      upsertGroup(context.runner, context.paths, entry)
      console.log(pc.green(`已保存组 '${name}'（${plugins.length} 个插件）`))
      console.log(`  分享: dshm group export ${name}`)
      console.log(`  应用: dshm group install ${name}`)
    })

  group
    .command('list')
    .description('list saved groups')
    .action(() => {
      const context = createContext()
      const groups = loadGroups(context.runner, context.paths).groups
      if (groups.length === 0) {
        console.log('还没有保存的组 — dshm group save <name> [ids…]')
        return
      }
      printTable(
        ['NAME', 'PLUGINS', 'PROFILE', 'DESCRIPTION'],
        groups.map((entry) => [
          entry.name,
          String(entry.plugins.length),
          entry.profile,
          entry.description.slice(0, 40),
        ]),
      )
    })

  group
    .command('show')
    .description('show one group\'s members')
    .argument('<name>', 'group name')
    .action((name: string) => {
      const context = createContext()
      const entry = findGroup(context.runner, context.paths, name)
      if (!entry) throw new Error(`group '${name}' not found`)
      console.log(`${pc.bold(entry.name)} (${entry.plugins.length} 个插件, profile ${entry.profile})`)
      if (entry.description) console.log(entry.description)
      for (const id of entry.plugins) console.log(`  - ${id}`)
    })

  group
    .command('install')
    .description('install every plugin in a group')
    .argument('<name>', 'group name')
    .option('--profile <name>', 'target profile')
    .action(async (name: string, flags: { profile?: string }) => {
      const context = createContext()
      const profile = resolveProfile(context, flags.profile ?? program.opts()['profile'])
      const merged = await loadMerged(context)
      const reports = await installGroup(
        {
          runner: context.runner,
          env: context.env,
          config: context.config,
          paths: context.paths,
        },
        merged.plugins,
        name,
        profile,
      )
      let failures = 0
      for (const report of reports) {
        if (report.outcome === 'installed') {
          console.log(pc.green(`  ✓ ${report.plugin}`))
        } else if (report.outcome === 'already-installed') {
          console.log(pc.dim(`  = ${report.plugin}（已安装）`))
        } else {
          failures++
          console.log(pc.red(`  ✗ ${report.plugin}: ${report.outcome}${report.detail ? ` — ${report.detail}` : ''}`))
        }
      }
      const ok = reports.length - failures
      console.log(`组 '${name}' 应用到 '${profile}': ${ok}/${reports.length} 成功`)
      if (failures > 0) process.exitCode = 1
    })

  group
    .command('remove')
    .description('delete a saved group')
    .argument('<name>', 'group name')
    .action((name: string) => {
      const context = createContext()
      if (!removeGroup(context.runner, context.paths, name)) {
        throw new Error(`group '${name}' not found`)
      }
      console.log(pc.green(`已删除组 '${name}'`))
    })

  group
    .command('export')
    .description('write a group\'s shareable YAML to stdout or a file')
    .argument('<name>', 'group name')
    .option('--file <path>', 'write to file instead of stdout')
    .action((name: string, flags: { file?: string }) => {
      const context = createContext()
      const entry = findGroup(context.runner, context.paths, name)
      if (!entry) throw new Error(`group '${name}' not found`)
      const yaml = exportGroupYaml(entry)
      if (flags.file) {
        writeFileSync(flags.file, yaml, 'utf8')
        console.log(pc.green(`已导出到 ${flags.file}`))
      } else {
        console.log(yaml)
      }
    })

  group
    .command('import')
    .description('save a group from a shared YAML document (file path or stdin)')
    .argument('<file>', 'path to a group YAML (- for stdin)')
    .action(async (file: string) => {
      const context = createContext()
      const { readFileSync } = await import('node:fs')
      const yaml = file === '-' ? await readStdin() : readFileSync(file, 'utf8')
      const imported = importGroupYaml(yaml)
      if ('error' in imported) throw new Error(imported.error)
      upsertGroup(context.runner, context.paths, imported)
      console.log(
        pc.green(`已导入组 '${imported.name}'（${imported.plugins.length} 个插件）— dshm group install ${imported.name} 应用`),
      )
    })
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => (data += chunk))
    process.stdin.on('end', () => resolve(data))
  })
}
