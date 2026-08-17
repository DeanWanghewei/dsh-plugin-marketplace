import { describe, expect, it } from 'vitest'
import {
  buildPnpmSpecFromGit,
  buildPnpmSpecFromNpm,
  injectHttpsToken,
  packageNameFromGitUrl,
} from '../src/index.js'

describe('pnpm spec construction', () => {
  it('npm specs carry an optional version', () => {
    expect(buildPnpmSpecFromNpm('@deepseek-ai/dsh-tool-cordis')).toBe(
      '@deepseek-ai/dsh-tool-cordis',
    )
    expect(buildPnpmSpecFromNpm('@deepseek-ai/dsh-tool-cordis', '0.1.0-rc.5')).toBe(
      '@deepseek-ai/dsh-tool-cordis@0.1.0-rc.5',
    )
  })

  it('git specs append a ref and leave ssh urls untouched', () => {
    expect(buildPnpmSpecFromGit('github:you/plugin', 'abc123')).toBe('github:you/plugin#abc123')
    expect(buildPnpmSpecFromGit('git+ssh://git@host/grp/repo')).toBe('git+ssh://git@host/grp/repo')
  })

  it('injects per-host https tokens as basic credentials', () => {
    const tokens = { 'git.example.com': 'sekrit' }
    expect(injectHttpsToken('https://git.example.com/grp/repo', tokens)).toBe(
      'https://x-access-token:sekrit@git.example.com/grp/repo',
    )
    expect(injectHttpsToken('https://github.com/x/y', tokens)).toBe('https://github.com/x/y')
  })

  it('derives a package name hint from git urls', () => {
    expect(packageNameFromGitUrl('github:you/hello-plugin')).toBe('hello-plugin')
    expect(packageNameFromGitUrl('git+ssh://git@host/grp/repo.git#dev')).toBe('repo')
  })
})
