import { join } from 'node:path'
import { stringify } from 'yaml'
import { describe, expect, it } from 'vitest'
import {
  curatedRegistryUrl,
  CURATED_REGISTRY_NAME,
  dshmPaths,
  loadConfig,
  type DshmConfig,
} from '../src/index.js'
import { FakeRunner, makeTestEnv } from './helpers.js'

const CURATED_ENV = { DSHM_CURATED_URL: 'https://example.com/curated.git' }

function writeConfig(runner: FakeRunner, home: string, config: Partial<DshmConfig>): void {
  runner.writeTextFile(
    dshmPaths(home).configFile,
    stringify({ defaultProfile: 'web', gitTokens: {}, ...config }),
  )
}

describe('curated default registry', () => {
  it('env override wins and "none" disables', () => {
    expect(curatedRegistryUrl(CURATED_ENV)).toBe('https://example.com/curated.git')
    expect(curatedRegistryUrl({ DSHM_CURATED_URL: 'none' })).toBe('')
    expect(curatedRegistryUrl({})).toMatch(/^https:/) // compiled-in default is live
  })

  it('ships in a fresh config', () => {
    const { env, dshmHome } = makeTestEnv()
    const runner = new FakeRunner()
    const { config, created } = loadConfig(runner, { ...env, ...CURATED_ENV })
    expect(created).toBe(true)
    const curated = config.registries.find((ref) => ref.name === CURATED_REGISTRY_NAME)
    expect(curated).toMatchObject({ type: 'git', url: CURATED_ENV['DSHM_CURATED_URL'] })
  })

  it('migrates an existing config by appending the curated source', () => {
    const { env, dshmHome } = makeTestEnv()
    const runner = new FakeRunner()
    writeConfig(runner, dshmHome, {
      registries: [{ name: 'default', type: 'file', path: '/tmp/r.yaml' }],
    })
    const { config, migrated } = loadConfig(runner, { ...env, ...CURATED_ENV })
    expect(migrated).toBe(true)
    expect(config.registries.map((ref) => ref.name)).toEqual(['default', CURATED_REGISTRY_NAME])
    // Migration is persisted — the next load does not append twice.
    const again = loadConfig(runner, { ...env, ...CURATED_ENV })
    expect(again.migrated).toBe(false)
    expect(again.config.registries).toHaveLength(2)
  })

  it('never re-adds a curated source the user removed', () => {
    const { env, dshmHome } = makeTestEnv()
    const runner = new FakeRunner()
    writeConfig(runner, dshmHome, {
      registries: [{ name: 'default', type: 'file', path: join(dshmHome, 'r.yaml') }],
      removedDefaults: [CURATED_REGISTRY_NAME],
    })
    const { config, migrated } = loadConfig(runner, { ...env, ...CURATED_ENV })
    expect(migrated).toBe(false)
    expect(config.registries.map((ref) => ref.name)).toEqual(['default'])
  })
})
