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
    const { env } = makeTestEnv()
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
    const { config, migrated } = loadConfig(runner, {
      ...env,
      ...CURATED_ENV,
      DSHM_NPM_SCAN: 'none',
    })
    expect(migrated).toBe(true)
    expect(config.registries.map((ref) => ref.name)).toEqual(['default', CURATED_REGISTRY_NAME])
    // Migration is persisted — the next load does not append twice.
    const again = loadConfig(runner, { ...env, ...CURATED_ENV, DSHM_NPM_SCAN: 'none' })
    expect(again.migrated).toBe(false)
    expect(again.config.registries).toHaveLength(2)
  })

  it('fresh config ships the npm-scan official source', () => {
    const { env } = makeTestEnv()
    const runner = new FakeRunner()
    const { config } = loadConfig(runner, { ...env, DSHM_CURATED_URL: 'none', DSHM_NPM_SCAN: 'yes' })
    const official = config.registries.find((ref) => ref.name === 'official')
    expect(official).toMatchObject({ type: 'npm-scan', scope: '@deepseek-ai/dsh' })
  })

  it('existing config migrates to gain official; removal sticks', () => {
    const { env, dshmHome } = makeTestEnv()
    const runner = new FakeRunner()
    writeConfig(runner, dshmHome, { registries: [] })
    const gained = loadConfig(runner, { ...env, DSHM_CURATED_URL: 'none', DSHM_NPM_SCAN: 'yes' })
    expect(gained.config.registries.some((ref) => ref.name === 'official')).toBe(true)

    writeConfig(runner, dshmHome, {
      registries: [],
      removedDefaults: ['official'],
    })
    const keptOut = loadConfig(runner, { ...env, DSHM_CURATED_URL: 'none', DSHM_NPM_SCAN: 'yes' })
    expect(keptOut.config.registries.some((ref) => ref.name === 'official')).toBe(false)
  })

  it('never re-adds a curated source the user removed', () => {
    const { env, dshmHome } = makeTestEnv()
    const runner = new FakeRunner()
    writeConfig(runner, dshmHome, {
      registries: [{ name: 'default', type: 'file', path: join(dshmHome, 'r.yaml') }],
      removedDefaults: [CURATED_REGISTRY_NAME],
    })
    const { config, migrated } = loadConfig(runner, {
      ...env,
      ...CURATED_ENV,
      DSHM_NPM_SCAN: 'none',
    })
    expect(migrated).toBe(false)
    expect(config.registries.map((ref) => ref.name)).toEqual(['default'])
  })
})
