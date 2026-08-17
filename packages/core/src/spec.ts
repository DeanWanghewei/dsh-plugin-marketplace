/** npm source → pnpm spec; `version` may be a semver range or dist-tag. */
export function buildPnpmSpecFromNpm(packageName: string, version?: string): string {
  return version ? `${packageName}@${version}` : packageName
}

/**
 * git source without subdir → pnpm git spec (`github:user/repo#ref`,
 * `git+ssh://…#ref`). https URLs get the per-host token injected when one is
 * configured, so private repos install without interactive prompts.
 */
export function buildPnpmSpecFromGit(
  url: string,
  ref?: string,
  gitTokens: Record<string, string> = {},
): string {
  const base = injectHttpsToken(url, gitTokens)
  return ref ? `${base}#${ref}` : base
}

export function injectHttpsToken(url: string, gitTokens: Record<string, string>): string {
  if (!url.startsWith('https://')) return url
  try {
    const parsed = new URL(url)
    const token = gitTokens[parsed.host]
    if (!token) return url
    parsed.username = 'x-access-token'
    parsed.password = token
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return url
  }
}

/** Best-effort package name guess from a git URL's final path segment. */
export function packageNameFromGitUrl(url: string): string {
  const cleaned = url.replace(/#.*$/, '').replace(/\.git$/, '')
  const last = cleaned.split('/').pop() ?? cleaned
  return last || cleaned
}
