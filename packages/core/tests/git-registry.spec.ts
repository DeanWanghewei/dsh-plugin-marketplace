import { join } from 'node:path'
import { stringify } from 'yaml'
import { describe, expect, it } from 'vitest'
import { dshmPaths, loadRegistries } from '../src/index.js'
import type { DshmConfig } from '../src/config.js'
import { FakeRunner, makeTestEnv } from './helpers.js'

const REGISTRY_DOC = stringify({
  schemaVersion: 1,
  name: 'gitreg',
  categories: [{ id: 'tool', name: { en: 'Tool' }, parent: null }],
  plugins: [
    { id: 'gp', name: 'git plugin', categories: ['tool'], source: { type: 'npm', package: 'gp' } },
  ],
})

function gitConfig(dshmHome: string, url: string): DshmConfig {
  return {
    defaultProfile: 'web',
    gitTokens: {},
    registries: [{ name: 'gitreg', type: 'git', url, ref: 'main' }],
  }
}

describe('git registry source', () => {
  it('clones on first load and serves later loads from the clone without git calls', async () => {
    const { dshmHome } = makeTestEnv()
    const runner = new FakeRunner()
    const gitCalls: string[] = []
    runner.on(
      (command, args) => command === 'git' && args[0] === 'clone',
      (args) => {
        gitCalls.push(args.join(' '))
        runner.writeTextFile(join(args[2]!, 'registry.yaml'), REGISTRY_DOC)
        return { ok: true, stdout: '', stderr: '' }
      },
    )
    runner.on(
      (command, args) => command === 'git' && args[0] === 'checkout',
      () => ({ ok: true, stdout: '', stderr: '' }),
    )
    const cacheDir = dshmPaths(dshmHome).cacheDir
    const first = await loadRegistries(
      runner,
      gitConfig(dshmHome, 'https://example.com/reg.git'),
      cacheDir,
    )
    expect(first.errors).toEqual([])
    expect(first.plugins.map((plugin) => plugin.qualifiedId)).toEqual(['gitreg:gp'])
    expect(gitCalls).toHaveLength(1)

    // Within the TTL the clone is served from disk — no further git activity.
    const second = await loadRegistries(
      runner,
      gitConfig(dshmHome, 'https://example.com/reg.git'),
      cacheDir,
    )
    expect(second.plugins).toHaveLength(1)
    expect(gitCalls).toHaveLength(1)
  })

  it('degrades to the stale clone when sync fails', async () => {
    const { dshmHome } = makeTestEnv()
    const runner = new FakeRunner()
    let cloned = false
    runner.on(
      (command, args) => command === 'git' && args[0] === 'clone',
      (args) => {
        cloned = true
        runner.writeTextFile(join(args[2]!, 'registry.yaml'), REGISTRY_DOC)
        return { ok: true, stdout: '', stderr: '' }
      },
    )
    runner.on(
      (command, args) => command === 'git' && args[0] === 'fetch',
      () => ({ ok: false, stdout: '', stderr: 'network down' }),
    )
    const cacheDir = dshmPaths(dshmHome).cacheDir
    const url = 'https://example.com/reg.git'
    await loadRegistries(runner, gitConfig(dshmHome, url), cacheDir, { forceRefresh: true })
    expect(cloned).toBe(true)

    // TTL expired + fetch failing: the existing clone still answers.
    const stale = await loadRegistries(runner, gitConfig(dshmHome, url), cacheDir, {
      forceRefresh: true,
    })
    expect(stale.errors).toEqual([])
    expect(stale.plugins.map((plugin) => plugin.qualifiedId)).toEqual(['gitreg:gp'])
  })

  it('reports a load error when the clone fails and nothing is cached', async () => {
    const { dshmHome } = makeTestEnv()
    const runner = new FakeRunner()
    runner.on(
      (command, args) => command === 'git' && args[0] === 'clone',
      () => ({ ok: false, stdout: '', stderr: 'repository not found' }),
    )
    const merged = await loadRegistries(
      runner,
      gitConfig(dshmHome, 'https://example.com/missing.git'),
      dshmPaths(dshmHome).cacheDir,
      { forceRefresh: true },
    )
    expect(merged.plugins).toEqual([])
    expect(merged.errors[0]?.message).toContain('git clone failed')
  })
})
