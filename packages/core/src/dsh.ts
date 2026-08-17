import { join } from 'node:path'
import { parse, stringify } from 'yaml'
import { profileDir, resolveDshHome } from './paths.js'
import { commandExists, type ExecResult, type Runner } from './runner.js'

export interface DshEnvironment {
  dshFound: boolean
  dshVersion?: string
  pnpmFound: boolean
  pnpmVersion?: string
  dshHome: string
  dshHomeExists: boolean
  profile: string
  profileDir: string
  profileExists: boolean
}

export async function detectEnvironment(
  runner: Runner,
  env: NodeJS.ProcessEnv,
  profile: string,
): Promise<DshEnvironment> {
  const dshFound = await commandExists(runner, 'dsh')
  const pnpmFound = await commandExists(runner, 'pnpm')
  const version = async (command: string): Promise<string | undefined> => {
    if (!(await commandExists(runner, command))) return undefined
    const result = await runner.run(command, ['--version'])
    return result.ok ? result.stdout.trim().split('\n')[0] : undefined
  }
  const dshHome = resolveDshHome(env)
  const dir = profileDir(dshHome, profile)
  return {
    dshFound,
    dshVersion: await version('dsh'),
    pnpmFound,
    pnpmVersion: await version('pnpm'),
    dshHome,
    dshHomeExists: runner.exists(dshHome),
    profile,
    profileDir: dir,
    profileExists: runner.exists(dir),
  }
}

/** `dsh plugin --profile <p> <args...>` — pnpm forwarder in the profile directory. */
export async function dshPlugin(
  runner: Runner,
  profile: string,
  args: string[],
): Promise<ExecResult> {
  return runner.run('dsh', ['plugin', '--profile', profile, ...args])
}

/** Compose-and-print without booting; used to verify an install landed. */
export async function dumpConfig(runner: Runner, profile: string): Promise<ExecResult> {
  return runner.run('dsh', ['--profile', profile, '--dump-config'])
}

/**
 * Extract package names from pnpm ≥10's ignored-build-scripts refusal, e.g.
 * `Ignored build scripts: dsh-hello-plugin.` Returns [] when the output is
 * some other failure.
 */
export function parseAllowBuildsKeys(output: string): string[] {
  const keys = new Set<string>()
  const line = output.split('\n').find((candidate) => candidate.includes('Ignored build scripts'))
  if (line) {
    const tail = line.slice(line.indexOf(':') + 1)
    for (const token of tail.split(/[,\s]+/)) {
      const name = token.replace(/[.:;]+$/, '')
      if (name && /^@?[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(name)) keys.add(name)
    }
  }
  if (keys.size === 0 && /allowBuilds/.test(output)) {
    const quoted = output.match(/["'`]([^"'`\s]+)["'`]/)
    if (quoted?.[1]) keys.add(quoted[1])
  }
  return [...keys]
}

/** Record `allowBuilds: { name: true }` in the profile's pnpm-workspace.yaml. */
export function writeAllowBuilds(runner: Runner, profileDirectory: string, keys: string[]): string {
  const file = join(profileDirectory, 'pnpm-workspace.yaml')
  const raw = runner.readTextFile(file)
  const doc = (raw !== undefined ? (parse(raw) as Record<string, unknown>) : {}) ?? {}
  const allow = (doc['allowBuilds'] as Record<string, boolean> | undefined) ?? {}
  for (const key of keys) allow[key] = true
  doc['allowBuilds'] = allow
  const next = stringify(doc)
  runner.writeTextFile(file, next)
  return file
}

export interface ProfileManifest {
  dependencies?: Record<string, string>
  bundles?: string[]
}

export function readProfileManifest(runner: Runner, profileDirectory: string): ProfileManifest {
  const raw = runner.readTextFile(join(profileDirectory, 'package.json'))
  if (raw === undefined) return {}
  try {
    const parsed = JSON.parse(raw) as {
      dependencies?: Record<string, string>
      dsh?: { profile?: { bundles?: string[] } }
    }
    return {
      dependencies: parsed.dependencies,
      bundles: parsed.dsh?.profile?.bundles,
    }
  } catch {
    return {}
  }
}
