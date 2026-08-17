import { statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface DshmPaths {
  home: string
  configFile: string
  storeFile: string
  cacheDir: string
  clonesDir: string
}

export function resolveDshmHome(env: NodeJS.ProcessEnv): string {
  const explicit = env['DSHM_HOME']?.trim()
  if (explicit) return resolve(explicit.replace(/^~(?=\/|$)/, env['HOME'] ?? ''))
  return join(env['HOME'] ?? process.env['HOME'] ?? '', '.dshm')
}

export function resolveDshHome(env: NodeJS.ProcessEnv): string {
  const explicit = env['DSH_HOME']?.trim()
  if (explicit) return resolve(explicit.replace(/^~(?=\/|$)/, env['HOME'] ?? ''))
  return join(env['HOME'] ?? process.env['HOME'] ?? '', '.dsh')
}

export function profileDir(dshHome: string, profile: string): string {
  return join(dshHome, 'profiles', profile)
}

export function dshmPaths(home: string): DshmPaths {
  return {
    home,
    configFile: join(home, 'config.yaml'),
    storeFile: join(home, 'store.json'),
    cacheDir: join(home, 'cache'),
    clonesDir: join(home, 'clones'),
  }
}

/**
 * Locate the repository's bundled seed registry by walking up from this module.
 * Works both from `src/` during development and from `lib/` after tsup builds.
 */
export function builtinRegistryPath(): string | undefined {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let depth = 0; depth < 8; depth++) {
    const candidate = resolve(dir, 'registry/default/registry.yaml')
    if (exists(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

function exists(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}
