import { basename, dirname, extname, join } from 'node:path'
import type { DshmConfig } from './config.js'
import {
  detectEnvironment,
  dshPlugin,
  parseAllowBuildsKeys,
  readInstalledPackageManifest,
  readProfileManifest,
  writeAllowBuilds,
} from './dsh.js'
import { profileDir, resolveDshHome, type DshmPaths } from './paths.js'
import { ensureBlock, managedRowBody, removeBlock } from './patchfile.js'
import type { Runner } from './runner.js'
import {
  buildPnpmSpecFromGit,
  buildPnpmSpecFromNpm,
  injectHttpsToken,
  packageNameFromGitUrl,
} from './spec.js'
import {
  addInstalled,
  clearPending,
  findInstalled,
  loadStore,
  removeInstalled,
  saveStore,
  setPending,
} from './store.js'
import type { PluginSource, ResolvedPlugin, StoreRecord } from './types.js'

export interface InstallerDeps {
  runner: Runner
  env: NodeJS.ProcessEnv
  config: DshmConfig
  paths: DshmPaths
}

export interface InstallOptions {
  profile: string
  ref?: string
  link?: boolean
  /** Write pnpm `allowBuilds` entries (build-script permission) and retry once. */
  allowBuild?: boolean
}

export type InstallOutcome =
  | { status: 'installed'; record: StoreRecord; warnings: string[]; hints: string[] }
  | { status: 'already-installed'; record: StoreRecord }
  | { status: 'allow-builds-required'; keys: string[] }

export type UninstallOutcome =
  | { status: 'uninstalled'; hints: string[] }
  | { status: 'not-installed' }
  | { status: 'error'; message: string }

type GitSource = Extract<PluginSource, { type: 'git' }>

const PATCH_FILE = 'cordis.patch.yml'

export async function installPlugin(
  deps: InstallerDeps,
  resolved: ResolvedPlugin,
  options: InstallOptions,
): Promise<InstallOutcome> {
  const { runner, env, paths } = deps
  const existing = findInstalled(loadStore(runner, paths), options.profile, resolved.qualifiedId)
  if (existing) return { status: 'already-installed', record: existing }

  const environment = await detectEnvironment(runner, env, options.profile)
  if (!environment.dshFound) throw new Error('dsh CLI not found on PATH — run `dshm doctor`')
  if (!environment.pnpmFound) {
    throw new Error('pnpm not found on PATH; `dsh plugin` forwards to pnpm and needs it')
  }

  if (resolved.entry.source.type === 'path' && runner.isFile(resolved.entry.source.path)) {
    const outcome = await installManagedRow(deps, resolved, options, environment.profileDir)
    await reportInstallIfHttp(deps, resolved, outcome)
    return outcome
  }
  const outcome = await installViaPnpm(deps, resolved, options)
  await reportInstallIfHttp(deps, resolved, outcome)
  return outcome
}

/**
 * Best-effort download-counter report for http-sourced marketplaces: one
 * fire-and-forget POST per successful install, 2s budget, all failures
 * silent. Local file/git registries have no endpoint to tell.
 */
async function reportInstallIfHttp(
  deps: InstallerDeps,
  resolved: ResolvedPlugin,
  outcome: InstallOutcome,
): Promise<void> {
  if (outcome.status !== 'installed') return
  const ref = deps.config.registries.find((entry) => entry.name === resolved.registry)
  if (!ref || ref.type !== 'http' || !ref.url) return
  const base = ref.url.replace(/\/api\/v1\/export\/?$/, '').replace(/\/$/, '')
  const endpoint = `${base}/api/v1/plugins/${resolved.entry.id}/report-install`
  try {
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client: 'cli', version: outcome.record.version.version }),
      signal: AbortSignal.timeout(2000),
    })
  } catch {
    // Statistics are optional; never fail an install over them.
  }
}

interface PnpmTarget {
  spec: string
  packageNameHint: string
}

async function resolvePnpmTarget(
  deps: InstallerDeps,
  source: PluginSource,
  options: InstallOptions,
): Promise<PnpmTarget> {
  const { config } = deps
  if (source.type === 'npm') {
    return {
      spec: buildPnpmSpecFromNpm(source.package, options.ref),
      packageNameHint: source.package,
    }
  }
  if (source.type === 'git') {
    const ref = options.ref ?? source.ref
    if (!source.subdir) {
      return {
        spec: buildPnpmSpecFromGit(source.url, ref, config.gitTokens),
        packageNameHint: packageNameFromGitUrl(source.url),
      }
    }
    // pnpm cannot address a monorepo subdirectory directly: clone, then add locally.
    const localDir = await cloneGitSource(deps, source, ref)
    return { spec: localDir, packageNameHint: basename(localDir) }
  }
  const linked = options.link || source.link
  return {
    spec: linked ? `link:${source.path}` : source.path,
    packageNameHint: basename(source.path),
  }
}

async function installViaPnpm(
  deps: InstallerDeps,
  resolved: ResolvedPlugin,
  options: InstallOptions,
): Promise<InstallOutcome> {
  const { runner, paths } = deps
  const { spec, packageNameHint } = await resolvePnpmTarget(deps, resolved.entry.source, options)

  const store = setPending(
    loadStore(runner, paths),
    options.profile,
    resolved.qualifiedId,
    'pnpm',
    runner.nowIso(),
  )
  saveStore(runner, paths, store)

  // `-w`: the profile's pnpm-workspace.yaml makes pnpm treat it as a workspace
  // root, and pnpm refuses a bare add/remove there without the explicit flag.
  const result = await dshPlugin(runner, options.profile, ['add', '-w', spec])
  if (result.ok) return commitPnpmInstall(deps, resolved, options, spec, packageNameHint, [])

  const keys = parseAllowBuildsKeys(`${result.stdout}\n${result.stderr}`)
  if (keys.length === 0 || !options.allowBuild) {
    saveStore(runner, paths, clearPending(loadStore(runner, paths), options.profile))
    if (keys.length > 0) return { status: 'allow-builds-required', keys }
    throw commandFailure(result)
  }
  const dshHome = resolveDshHome(deps.env)
  writeAllowBuilds(runner, profileDir(dshHome, options.profile), keys)
  const retry = await dshPlugin(runner, options.profile, ['add', '-w', spec])
  if (!retry.ok) {
    saveStore(runner, paths, clearPending(loadStore(runner, paths), options.profile))
    throw commandFailure(retry)
  }
  return commitPnpmInstall(deps, resolved, options, spec, packageNameHint, [
    `build scripts allowed for: ${keys.join(', ')}`,
  ])
}

function commandFailure(result: {
  ok: boolean
  stdout: string
  stderr: string
  command: string
}): Error {
  const tail = `${result.stdout}\n${result.stderr}`.trim().split('\n').slice(-15).join('\n')
  return new Error(`\`${result.command}\` failed:\n${tail}`)
}

async function commitPnpmInstall(
  deps: InstallerDeps,
  resolved: ResolvedPlugin,
  options: InstallOptions,
  spec: string,
  packageNameHint: string,
  warnings: string[],
): Promise<InstallOutcome> {
  const { runner, env, paths } = deps
  const profileDirectory = profileDir(resolveDshHome(env), options.profile)
  const manifest = readProfileManifest(runner, profileDirectory)
  const hintBase = basename(packageNameHint)
  // Path specs install under the package's scoped name (@scope/dir-name), so
  // match dependencies by exact name, bare basename, or scoped suffix.
  const packageName =
    Object.keys(manifest.dependencies ?? {}).find(
      (name) => name === packageNameHint || name === hintBase || name.endsWith(`/${hintBase}`),
    ) ?? packageNameHint
  // A package declaring `dsh.bundle` already joined the layer stack through
  // `dsh plugin`'s reconcile. Bundle-less packages (older npm releases) stay
  // inert plain dependencies, so dshm activates them with an explicit
  // profile-patch row naming the installed package.
  let managed: StoreRecord['managed']
  const installed = readInstalledPackageManifest(runner, profileDirectory, packageName)
  if (installed !== undefined && installed.dsh?.bundle === undefined) {
    const patchPath = join(profileDirectory, PATCH_FILE)
    const current = runner.readTextFile(patchPath) ?? '[]\n'
    runner.writeTextFile(
      patchPath,
      ensureBlock(current, resolved.entry.id, managedRowBody(resolved.entry.id, packageName)),
    )
    managed = { rowId: resolved.entry.id, entryRelPath: '' }
    warnings.push(`${packageName} declares no dsh bundle patch; activated via a profile-patch row`)
  }
  const record: StoreRecord = {
    pluginId: resolved.qualifiedId,
    registry: resolved.registry,
    entryName: resolved.entry.name,
    installedAt: runner.nowIso(),
    strategy: 'pnpm',
    version: { spec, version: manifest.dependencies?.[packageName] },
    packageName,
    managed,
  }
  saveStore(runner, paths, addInstalled(loadStore(runner, paths), options.profile, record))
  return { status: 'installed', record, warnings, hints: installHints(options.profile) }
}

async function installManagedRow(
  deps: InstallerDeps,
  resolved: ResolvedPlugin,
  options: InstallOptions,
  profileDirectory: string,
): Promise<InstallOutcome> {
  const { runner, paths } = deps
  if (resolved.entry.source.type !== 'path') throw new Error('managed-row requires a path source')
  if (!runner.exists(profileDirectory)) {
    throw new Error(
      `profile directory ${profileDirectory} does not exist; boot it once (dsh --profile ${options.profile}) or install a package plugin first`,
    )
  }
  const sourcePath = resolved.entry.source.path
  const extension = extname(sourcePath) || '.ts'
  const entryRelPath = `./dshm/${resolved.entry.id}/index${extension}`

  const store = setPending(
    loadStore(runner, paths),
    options.profile,
    resolved.qualifiedId,
    'managed-row',
    runner.nowIso(),
  )
  saveStore(runner, paths, store)

  runner.copyFile(sourcePath, join(profileDirectory, entryRelPath))
  const patchPath = join(profileDirectory, PATCH_FILE)
  const current = runner.readTextFile(patchPath) ?? '[]\n'
  runner.writeTextFile(
    patchPath,
    ensureBlock(current, resolved.entry.id, managedRowBody(resolved.entry.id, entryRelPath)),
  )

  const record: StoreRecord = {
    pluginId: resolved.qualifiedId,
    registry: resolved.registry,
    entryName: resolved.entry.name,
    installedAt: runner.nowIso(),
    strategy: 'managed-row',
    version: { spec: sourcePath },
    managed: { rowId: resolved.entry.id, entryRelPath },
  }
  saveStore(runner, paths, addInstalled(loadStore(runner, paths), options.profile, record))
  return { status: 'installed', record, warnings: [], hints: installHints(options.profile) }
}

async function cloneGitSource(
  deps: InstallerDeps,
  source: GitSource,
  ref: string | undefined,
): Promise<string> {
  const { runner, config, paths } = deps
  const url = injectHttpsToken(source.url, config.gitTokens)
  const slug =
    `${source.url}${ref ?? ''}`.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'repo'
  const target = join(paths.clonesDir, slug)
  if (runner.exists(target)) runner.rm(target)
  const clone = await runner.run('git', ['clone', url, target])
  if (!clone.ok) {
    runner.rm(target)
    throw new Error(
      `git clone failed for ${source.url}:\n${clone.stderr.trim()}\n` +
        '(private repo? add a token: dshm config set gitTokens.<host> <token>)',
    )
  }
  if (ref) {
    const checkout = await runner.run('git', ['checkout', ref], { cwd: target })
    if (!checkout.ok) {
      throw new Error(`git checkout ${ref} failed: ${checkout.stderr.trim()}`)
    }
  }
  return join(target, source.subdir ?? '.')
}

function installHints(profile: string): string[] {
  return [
    `verify without booting: dsh --profile ${profile} --dump-config`,
    'a running dsh watches cordis.patch.yml and hot-applies this change',
  ]
}

export async function uninstallPlugin(
  deps: InstallerDeps,
  pluginId: string,
  profile: string,
): Promise<UninstallOutcome> {
  const { runner, env, paths } = deps
  const record = findInstalled(loadStore(runner, paths), profile, pluginId)
  if (!record) return { status: 'not-installed' }

  const hints: string[] = []
  // Drop the activation row first: a running dsh hot-reloads the patch file,
  // and the row would reference a package that is about to disappear.
  if (record.managed) {
    const directory = profileDir(resolveDshHome(env), profile)
    const patchPath = join(directory, PATCH_FILE)
    const current = runner.readTextFile(patchPath)
    if (current !== undefined) {
      runner.writeTextFile(patchPath, removeBlock(current, record.managed.rowId))
    }
    if (record.strategy === 'managed-row') {
      // Remove the whole managed plugin directory (dshm/<id>), not just the entry file.
      runner.rm(join(directory, dirname(record.managed.entryRelPath)))
    }
  }
  if (record.strategy === 'pnpm' && record.packageName) {
    const result = await dshPlugin(runner, profile, ['remove', '-w', record.packageName])
    if (!result.ok) {
      hints.push(`\`dsh plugin remove ${record.packageName}\` failed; store entry cleared anyway`)
    }
  }
  saveStore(runner, paths, removeInstalled(loadStore(runner, paths), profile, record.pluginId))
  return {
    status: 'uninstalled',
    hints: [...hints, `verify: dsh --profile ${profile} --dump-config`],
  }
}
