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
import {
  disableBlock,
  disabledRowBody,
  enableBlock,
  ensureBlock,
  managedRowBody,
  removeBlock,
} from './patchfile.js'
import type { Runner } from './runner.js'
import {
  buildPnpmSpecFromGit,
  buildPnpmSpecFromNpm,
  injectHttpsToken,
  packageNameFromGitUrl,
} from './spec.js'
import { loadRegistries } from './registry.js'
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

  // A pinned ref that the repo no longer carries (registry says `main`,
  // default branch is `master`) fails resolution before anything runs.
  // One retry without the ref — pnpm then resolves the default branch HEAD.
  if (/Could not resolve/.test(`${result.stdout}\n${result.stderr}`)) {
    const hint = packageNameHint
    const retrySpec = buildPnpmSpecFromGit(
      resolved.entry.source.type === 'git' ? resolved.entry.source.url : '',
      undefined,
      deps.config.gitTokens,
    )
    if (retrySpec && retrySpec !== spec) {
      const retry = await dshPlugin(runner, options.profile, ['add', '-w', retrySpec])
      if (retry.ok) {
        return commitPnpmInstall(deps, resolved, options, retrySpec, hint, [
          `pinned ref unavailable — installed from the default branch instead`,
        ])
      }
    }
  }

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
  // Path specs install under the package's scoped name, whose suffix may
  // carry a dsh- prefix the directory lacks (packages/mcp/mcp-client →
  // @deepseek-ai/dsh-mcp-client), so match bare and prefixed variants.
  const hintCandidates = [hintBase, `dsh-${hintBase}`]
  const packageName =
    Object.keys(manifest.dependencies ?? {}).find((name) =>
      hintCandidates.some(
        (candidate) => name === candidate || name.endsWith(`/${candidate}`),
      ),
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
    const body = resolved.entry.requiresConfig
      ? disabledRowBody(resolved.entry.id, packageName)
      : managedRowBody(resolved.entry.id, packageName)
    runner.writeTextFile(patchPath, ensureBlock(current, resolved.entry.id, body))
    managed = { rowId: resolved.entry.id, entryRelPath: '' }
    warnings.push(
      resolved.entry.requiresConfig
        ? `${packageName} needs transport config; row inserted disabled — edit ${patchPath} to enable`
        : `${packageName} declares no dsh bundle patch; activated via a profile-patch row`,
    )
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
  if (!record) {
    // Uncataloged installs: the profile holds the package but dshm never
    // recorded it (manual `dsh plugin add`, private plugins). Removing the
    // dependency is the honest uninstall — installation visibility must not
    // depend on dshm having done the install.
    const pkgName = pluginId.startsWith('uncataloged:') ? pluginId.slice('uncataloged:'.length) : pluginId
    const { profilePackages } = await import('./installed.js')
    if (profilePackages(runner, env, profile).has(pkgName)) {
      const result = await dshPlugin(runner, profile, ['remove', '-w', pkgName])
      if (!result.ok) return { status: 'error', message: `移除依赖 ${pkgName} 失败` }
      return {
        status: 'uninstalled',
        hints: [
          `已移除依赖 ${pkgName}（非 dshm 安装，registry 未收录）`,
          `verify: dsh --profile ${profile} --dump-config`,
        ],
      }
    }
    return { status: 'not-installed' }
  }

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


export type ToggleOutcome =
  | { status: 'enabled'; hints: string[] }
  | { status: 'disabled'; hints: string[] }
  | { status: 'not-managed'; message: string }
  | { status: 'config-required'; message: string }

/**
 * Enable a dshm-managed activation row. Config-required plugins refuse to
 * enable without inline configYaml (or config already present in the row).
 */
export async function enablePlugin(
  deps: InstallerDeps,
  pluginId: string,
  profile: string,
  configYaml?: string,
): Promise<ToggleOutcome> {
  const { runner, env, paths, config } = deps
  const record = findInstalled(loadStore(runner, paths), profile, pluginId)
  if (!record?.managed) {
    return {
      status: 'not-managed',
      message: `'${pluginId}' 不是 dshm 管理的激活行（仅 dshm 安装的插件支持 enable/disable）`,
    }
  }
  const directory = profileDir(resolveDshHome(env), profile)
  const patchPath = join(directory, PATCH_FILE)
  const current = runner.readTextFile(patchPath)
  if (current === undefined) return { status: 'not-managed', message: 'cordis.patch.yml missing' }
  const body = current
    .split('\n')
    .slice(
      (locate(current, record.managed.rowId)?.start ?? 0) + 1,
      locate(current, record.managed.rowId)?.end ?? 0,
    )
    .join('\n')
  const hasConfig = /\n\s{4}config:/.test(`\n${body}`)
  const merged = await loadRegistries(runner, config, paths.cacheDir)
  const entry = merged.plugins.find((plugin) => plugin.qualifiedId === record.pluginId)
  if (entry?.entry.requiresConfig && !hasConfig && configYaml === undefined) {
    return {
      status: 'config-required',
      message:
        `'${entry.entry.id}' 需要 transport 配置才能启动。用 --config 传入，例如：\n` +
        `  --config "serverName: my-mcp, transport: stdio, command: npx, args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp']"`,
    }
  }
  const next = await enableBlock(current, record.managed.rowId, configYaml)
  runner.writeTextFile(patchPath, next)
  return {
    status: 'enabled',
    hints: [`运行中的 dsh 会热加载；验证: dsh --profile ${profile} --dump-config`],
  }
}

function locate(content: string, id: string): { start: number; end: number } | undefined {
  const lines = content.split('\n')
  const start = lines.findIndex((line) => line.trim() === `# >>> dshm:${id}`)
  if (start === -1) return undefined
  const end = lines.findIndex((line) => line.trim() === `# <<< dshm:${id}`)
  if (end === -1 || end < start) return undefined
  return { start, end }
}

/** Disable a dshm-managed activation row (plugin stays installed). */
export async function disablePlugin(
  deps: InstallerDeps,
  pluginId: string,
  profile: string,
): Promise<ToggleOutcome> {
  const { runner, env, paths } = deps
  const record = findInstalled(loadStore(runner, paths), profile, pluginId)
  if (!record?.managed) {
    return {
      status: 'not-managed',
      message: `'${pluginId}' 不是 dshm 管理的激活行`,
    }
  }
  const patchPath = join(profileDir(resolveDshHome(env), profile), PATCH_FILE)
  const current = runner.readTextFile(patchPath)
  if (current === undefined) return { status: 'not-managed', message: 'cordis.patch.yml missing' }
  runner.writeTextFile(patchPath, disableBlock(current, record.managed.rowId))
  return { status: 'disabled', hints: [`验证: dsh --profile ${profile} --dump-config`] }
}
