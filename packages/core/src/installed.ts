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

/** Package names present in a profile: dependencies plus declared bundles. */
export function profilePackages(
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

/** Match registry plugins against the packages a profile actually holds. */
export function matchProfilePlugins(
  runner: Runner,
  packages: Map<string, string>,
  plugins: ResolvedPlugin[],
): Map<string, InstalledOrigin> {
  const matches = new Map<string, InstalledOrigin>()
  for (const plugin of plugins) {
    const source = plugin.entry.source
    const candidates =
      source.type === 'npm'
        ? [source.package]
        : source.type === 'git'
          ? [packageNameFromGitUrl(source.url)]
          : [pathPackageName(runner, source.path)].filter(Boolean)
    for (const name of candidates) {
      const version = packages.get(name as string)
      if (version !== undefined) {
        matches.set(plugin.qualifiedId, { kind: 'profile', packageName: name, version })
        break
      }
    }
  }
  return matches
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
