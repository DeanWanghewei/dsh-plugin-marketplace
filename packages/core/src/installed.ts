import { join } from 'node:path'
import { readProfileManifest } from './dsh.js'
import { profileDir, resolveDshHome } from './paths.js'
import { packageNameFromGitUrl } from './spec.js'
import type { ResolvedPlugin, Runner } from './index.js'

/**
 * Installed-state detection.
 *
 * dshm's own store only records what dshm installed. A real profile also
 * carries in-box bundles and manually added dependencies in its package.json
 * (`dsh.profile.bundles` + `dependencies`), so "installed" is the union of
 * both, with the origin kept for display.
 */

export interface InstalledOrigin {
  /** Installed by dshm (store record) vs already present in the profile. */
  kind: 'dshm' | 'profile'
  packageName?: string
  version?: string
}

/** Package names present in a profile: dependencies plus declared bundles,
 * expanded with each installed bundle's own dependencies (so in-box
 * compositions like dsh-base count their member plugins as present). */
export function profilePackages(
  runner: Runner,
  env: NodeJS.ProcessEnv,
  profile: string,
): Map<string, string> {
  const directory = profileDir(resolveDshHome(env), profile)
  const manifest = readProfileManifest(runner, directory)
  const packages = new Map<string, string>()
  for (const [name, spec] of Object.entries(manifest.dependencies ?? {})) {
    packages.set(name, spec)
  }
  const bundleClosure = (bundle: string, seen = new Set<string>()): void => {
    if (seen.has(bundle)) return
    seen.add(bundle)
    if (!packages.has(bundle)) packages.set(bundle, 'bundle')
    // In-box bundles are not installed into the profile directory; their
    // manifests live in the installation's symlink farm next to it.
    const candidates = [
      join(directory, 'node_modules', bundle, 'package.json'),
      join(directory, '..', 'node_modules', bundle, 'package.json'),
    ]
    const raw = candidates.map((path) => runner.readTextFile(path)).find(Boolean)
    if (raw === undefined) return
    try {
      const deps = (JSON.parse(raw) as { dependencies?: Record<string, string> }).dependencies
      for (const name of Object.keys(deps ?? {})) bundleClosure(name, seen)
    } catch {
      // A bundle manifest we cannot parse contributes no closure.
    }
  }
  for (const name of manifest.bundles ?? []) bundleClosure(name)
  return packages
}

/** The npm package name a path-source entry refers to, read from its manifest. */
function pathPackageName(runner: Runner, path: string): string | undefined {
  const raw = runner.readTextFile(join(path, 'package.json'))
  if (raw === undefined) return undefined
  try {
    return (JSON.parse(raw) as { name?: string }).name || undefined
  } catch {
    return undefined
  }
}

/** All npm names one registry entry can appear as in a profile manifest. */
function candidateNames(runner: Runner, plugin: ResolvedPlugin): string[] {
  const source = plugin.entry.source
  if (source.type === 'npm') return [source.package]
  if (source.type === 'git') return [packageNameFromGitUrl(source.url)]
  const pathName = pathPackageName(runner, source.path)
  return pathName ? [pathName] : []
}

/** Match registry plugins against the packages a profile actually holds. */
export function matchProfilePlugins(
  runner: Runner,
  packages: Map<string, string>,
  plugins: ResolvedPlugin[],
): Map<string, InstalledOrigin> {
  const matches = new Map<string, InstalledOrigin>()
  for (const plugin of plugins) {
    for (const name of candidateNames(runner, plugin)) {
      const version = packages.get(name)
      if (version !== undefined) {
        matches.set(plugin.qualifiedId, { kind: 'profile', packageName: name, version })
        break
      }
    }
  }
  return matches
}

/** Direct holdings only: manifest dependencies plus declared bundles, WITHOUT
 * the transitive closure — library deps of bundles (babel, js-tokens, …) are
 * not plugins and must not flood the uncataloged view. */
export function directProfilePackages(
  runner: Runner,
  env: NodeJS.ProcessEnv,
  profile: string,
): Map<string, string> {
  const manifest = readProfileManifest(runner, profileDir(resolveDshHome(env), profile))
  const packages = new Map<string, string>()
  for (const [name, spec] of Object.entries(manifest.dependencies ?? {})) {
    packages.set(name, spec)
  }
  for (const name of manifest.bundles ?? []) {
    if (!packages.has(name)) packages.set(name, 'bundle')
  }
  return packages
}

export interface UncatalogedPackage {
  packageName: string
  version: string
}

/**
 * Packages a profile actually holds that NO registry catalogs: private
 * plugins, manual `dsh plugin add`s, anything the marketplaces never
 * indexed. They stay visible and manageable — installation state must not
 * depend on catalog coverage.
 */
export function uncatalogedPackages(
  runner: Runner,
  packages: Map<string, string>,
  plugins: ResolvedPlugin[],
): UncatalogedPackage[] {
  const known = new Set<string>()
  for (const plugin of plugins) {
    for (const name of candidateNames(runner, plugin)) known.add(name)
  }
  return [...packages]
    .filter(([name]) => !known.has(name))
    .map(([packageName, version]) => ({ packageName, version }))
}

/**
 * Full installed view for one profile: dshm store records merged with
 * profile-present packages, keyed by qualified plugin id.
 */
export function installedView(
  runner: Runner,
  env: NodeJS.ProcessEnv,
  profile: string,
  plugins: ResolvedPlugin[],
  storeRecords: Array<{ pluginId: string; packageName?: string; version: { version?: string } }>,
): Map<string, InstalledOrigin> {
  const view = new Map<string, InstalledOrigin>()
  for (const plugin of plugins) {
    const record = storeRecords.find((entry) => entry.pluginId === plugin.qualifiedId)
    if (record) {
      view.set(plugin.qualifiedId, {
        kind: 'dshm',
        packageName: record.packageName,
        version: record.version.version,
      })
    }
  }
  for (const [qualifiedId, origin] of matchProfilePlugins(
    runner,
    profilePackages(runner, env, profile),
    plugins,
  )) {
    if (!view.has(qualifiedId)) view.set(qualifiedId, origin)
  }
  return view
}
