import { join } from 'node:path'
import { stringify } from 'yaml'
import { describe, expect, it } from 'vitest'
import { dshmPaths, loadRegistries } from '../src/index.js'
import type { DshmConfig } from '../src/config.js'
import { FakeRunner, makeTestEnv } from './helpers.js'

function stringifyYaml(doc: unknown): string {
  return stringify(doc)
}

function writeRegistry(runner: FakeRunner, path: string, name: string, ids: string[]): void {
  const doc = {
    schemaVersion: 1,
    name,
    categories: [{ id: 'tool', name: { en: 'Tool' }, parent: null }],
    plugins: ids.map((id) => ({
      id,
      name: id,
      categories: ['tool'],
      source: { type: 'npm', package: `pkg-${id}` },
    })),
  }
  runner.writeTextFile(path, stringifyYaml(doc))
}

describe('loadRegistries', () => {
  it('merges file registries in priority order and namespaces plugins', async () => {
    const { dshmHome } = makeTestEnv()
    const runner = new FakeRunner()
    const first = join(dshmHome, 'first.yaml')
    const second = join(dshmHome, 'second.yaml')
    writeRegistry(runner, first, 'first', ['alpha', 'shared'])
    writeRegistry(runner, second, 'second', ['shared', 'beta'])
    const config: DshmConfig = {
      defaultProfile: 'web',
      gitTokens: {},
      registries: [
        { name: 'first', type: 'file', path: first },
        { name: 'second', type: 'file', path: second },
      ],
    }
    const merged = await loadRegistries(runner, config, dshmPaths(dshmHome).cacheDir)
    expect(merged.errors).toEqual([])
    // Same bare id in two registries coexists under distinct qualified ids;
    // `resolvePluginById` is what forces disambiguation at lookup time.
    expect(merged.plugins.map((plugin) => plugin.qualifiedId).sort()).toEqual([
      'first:alpha',
      'first:shared',
      'second:beta',
      'second:shared',
    ])
  })

  it('reports unreadable registries as errors instead of throwing', async () => {
    const { dshmHome } = makeTestEnv()
    const runner = new FakeRunner()
    const config: DshmConfig = {
      defaultProfile: 'web',
      gitTokens: {},
      registries: [{ name: 'gone', type: 'file', path: join(dshmHome, 'missing.yaml') }],
    }
    const merged = await loadRegistries(runner, config, dshmPaths(dshmHome).cacheDir)
    expect(merged.plugins).toEqual([])
    expect(merged.errors[0]?.registry).toBe('gone')
  })

  it('warns when a plugin references an unknown category', async () => {
    const { dshmHome } = makeTestEnv()
    const runner = new FakeRunner()
    const path = join(dshmHome, 'one.yaml')
    runner.writeTextFile(
      path,
      stringifyYaml({
        schemaVersion: 1,
        name: 'one',
        categories: [],
        plugins: [
          { id: 'p', name: 'p', categories: ['ghost'], source: { type: 'npm', package: 'p' } },
        ],
      }),
    )
    const config: DshmConfig = {
      defaultProfile: 'web',
      gitTokens: {},
      registries: [{ name: 'one', type: 'file', path }],
    }
    const merged = await loadRegistries(runner, config, dshmPaths(dshmHome).cacheDir)
    expect(merged.warnings[0]?.message).toContain("unknown category 'ghost'")
  })
})
