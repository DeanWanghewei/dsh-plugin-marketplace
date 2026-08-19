import { join } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { DshmPaths, InstallerDeps, ResolvedPlugin } from './index.js'
import type { InstallOutcome } from './installer.js'
import { installPlugin } from './installer.js'
import type { Runner } from './runner.js'

/**
 * Plugin groups: a named, shareable set of plugin ids plus the profile state
 * they were captured from. Teammates import a group and `dshm group install`
 * replays it — one command instead of remembering every plugin.
 */

export interface PluginGroup {
  name: string
  description: string
  /** Qualified or bare plugin ids, in install order. */
  plugins: string[]
  /** Profile the group was captured from. */
  profile: string
  createdAt: string
}

interface GroupFile {
  schemaVersion: 1
  groups: PluginGroup[]
}

function emptyFile(): GroupFile {
  return { schemaVersion: 1, groups: [] }
}

export function groupFilePath(paths: DshmPaths): string {
  return join(paths.home, 'groups.json')
}

export function loadGroups(runner: Runner, paths: DshmPaths): GroupFile {
  const raw = runner.readTextFile(groupFilePath(paths))
  if (raw === undefined) return emptyFile()
  try {
    const parsed = JSON.parse(raw) as Partial<GroupFile>
    if (parsed.schemaVersion !== 1) return emptyFile()
    return { schemaVersion: 1, groups: parsed.groups ?? [] }
  } catch {
    return emptyFile()
  }
}

export function saveGroups(runner: Runner, paths: DshmPaths, file: GroupFile): void {
  const tmp = `${groupFilePath(paths)}.tmp`
  runner.writeTextFile(tmp, `${JSON.stringify(file, null, 2)}\n`)
  runner.rename(tmp, groupFilePath(paths))
}

export function upsertGroup(
  runner: Runner,
  paths: DshmPaths,
  group: PluginGroup,
): PluginGroup[] {
  const file = loadGroups(runner, paths)
  file.groups = file.groups.filter((entry) => entry.name !== group.name)
  file.groups.push(group)
  saveGroups(runner, paths, file)
  return file.groups
}

export function removeGroup(runner: Runner, paths: DshmPaths, name: string): boolean {
  const file = loadGroups(runner, paths)
  const before = file.groups.length
  file.groups = file.groups.filter((entry) => entry.name !== name)
  if (file.groups.length === before) return false
  saveGroups(runner, paths, file)
  return true
}

export function findGroup(
  runner: Runner,
  paths: DshmPaths,
  name: string,
): PluginGroup | undefined {
  return loadGroups(runner, paths).groups.find((entry) => entry.name === name)
}

export interface GroupInstallReport {
  plugin: string
  outcome: InstallOutcome['status'] | 'error'
  detail?: string
}

/** Install every member of a group in order; failures don't stop the rest. */
export async function installGroup(
  deps: InstallerDeps,
  merged: ResolvedPlugin[],
  groupName: string,
  profile: string,
): Promise<GroupInstallReport[]> {
  const { runner, paths } = deps
  const group = findGroup(runner, paths, groupName)
  if (!group) throw new Error(`group '${groupName}' not found`)
  const reports: GroupInstallReport[] = []
  for (const id of group.plugins) {
    const resolved = merged.find(
      (plugin) => plugin.qualifiedId === id || plugin.entry.id === id,
    )
    if (!resolved) {
      reports.push({ plugin: id, outcome: 'error', detail: 'not found in any registry' })
      continue
    }
    try {
      const outcome = await installPlugin(deps, resolved, { profile })
      reports.push({
        plugin: resolved.entry.id,
        outcome: outcome.status,
        detail:
          outcome.status === 'allow-builds-required'
            ? `needs build permission: ${outcome.keys.join(', ')}`
            : undefined,
      })
    } catch (error) {
      reports.push({
        plugin: resolved.entry.id,
        outcome: 'error',
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return reports
}

/** YAML document for sharing a group (paste into a repo, a chat, anything). */
export function exportGroupYaml(group: PluginGroup): string {
  return `# dshm 插件组 — 安装: dshm group install < save 到本地后 > 或直接 import 此文件\n${stringifyYaml({
    dshmGroup: {
      name: group.name,
      description: group.description,
      profile: group.profile,
      plugins: group.plugins,
    },
  })}`
}

/** Parse a shared group YAML back into a PluginGroup. */
export function importGroupYaml(yaml: string): PluginGroup | { error: string } {
  let parsed: unknown
  try {
    parsed = parseYaml(yaml)
  } catch (error) {
    return { error: `invalid YAML: ${error instanceof Error ? error.message : String(error)}` }
  }
  const doc = (parsed as { dshmGroup?: Partial<PluginGroup> }).dshmGroup
  if (!doc || typeof doc.name !== 'string' || !Array.isArray(doc.plugins)) {
    return { error: 'document must carry dshmGroup: { name, plugins: [...] }' }
  }
  return {
    name: doc.name,
    description: typeof doc.description === 'string' ? doc.description : '',
    profile: typeof doc.profile === 'string' ? doc.profile : 'web',
    plugins: doc.plugins.filter((id): id is string => typeof id === 'string'),
    createdAt: new Date().toISOString(),
  }
}
