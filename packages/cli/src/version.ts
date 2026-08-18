import { readFileSync } from 'node:fs'

/** Version of this dshm-cli, read from the package manifest next to the code. */
export function readOwnVersion(): string {
  const candidates = [
    new URL('../package.json', import.meta.url),
    new URL('../../package.json', import.meta.url),
  ]
  for (const url of candidates) {
    try {
      const version = (JSON.parse(readFileSync(url, 'utf8')) as { version?: string }).version
      if (version) return version
    } catch {
      // Try the next candidate (src vs lib layouts).
    }
  }
  return '0.0.0-unknown'
}

/** Latest published version from the npm registry; undefined when offline. */
export async function latestPublishedVersion(
  registry = 'https://registry.npmjs.org',
): Promise<string | undefined> {
  try {
    const response = await fetch(`${registry}/dshm-cli/latest`, {
      signal: AbortSignal.timeout(4000),
    })
    if (!response.ok) return undefined
    const version = ((await response.json()) as { version?: string }).version
    return version && /^\d/.test(version) ? version : undefined
  } catch {
    return undefined
  }
}

/** Semver-ish comparison: positive when a is newer than b. */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string): number[] =>
    value
      .replace(/^v/, '')
      .split(/[.-]/)
      .map((part) => Number.parseInt(part, 10) || 0)
  const left = parse(a)
  const right = parse(b)
  for (let index = 0; index < 3; index++) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0)
    if (delta !== 0) return delta
  }
  return 0
}
