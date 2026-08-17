import { describe, expect, it } from 'vitest'
import { dshmPaths, type StoreFile } from '../src/index.js'
import {
  addInstalled,
  clearPending,
  findInstalled,
  listInstalled,
  loadStore,
  removeInstalled,
  saveStore,
  setPending,
} from '../src/store.js'
import { FakeRunner, makeTestEnv } from './helpers.js'

function freshStore(): StoreFile {
  return { schemaVersion: 1, profiles: {}, pending: {} }
}

const record = {
  pluginId: 'default:hello',
  registry: 'default',
  entryName: 'Hello',
  installedAt: '2026-01-01T00:00:00.000Z',
  strategy: 'pnpm' as const,
  version: { spec: 'hello-pkg' },
  packageName: 'hello-pkg',
}

describe('store journal', () => {
  it('round-trips through disk atomically', () => {
    const { dshmHome } = makeTestEnv()
    const runner = new FakeRunner()
    const paths = dshmPaths(dshmHome)
    const store = addInstalled(
      setPending(freshStore(), 'web', 'default:hello', 'pnpm', 'now'),
      'web',
      record,
    )
    saveStore(runner, paths, store)
    const reloaded = loadStore(runner, paths)
    expect(listInstalled(reloaded, 'web')).toHaveLength(1)
    expect(reloaded.pending['web']).toBeUndefined()
  })

  it('clearPending unwinds an interrupted install', () => {
    let store = setPending(freshStore(), 'web', 'default:hello', 'pnpm', 'now')
    expect(store.pending['web']?.pluginId).toBe('default:hello')
    store = clearPending(store, 'web')
    expect(store.pending['web']).toBeUndefined()
  })

  it('finds by qualified id and by bare suffix', () => {
    const store = addInstalled(freshStore(), 'web', record)
    expect(findInstalled(store, 'web', 'default:hello')?.pluginId).toBe('default:hello')
    expect(findInstalled(store, 'web', 'hello')?.pluginId).toBe('default:hello')
    expect(findInstalled(store, 'web', 'missing')).toBeUndefined()
    expect(findInstalled(store, 'other', 'hello')).toBeUndefined()
  })

  it('removeInstalled drops only the targeted record', () => {
    const store = addInstalled(addInstalled(freshStore(), 'web', record), 'web', {
      ...record,
      pluginId: 'default:other',
    })
    const next = removeInstalled(store, 'web', 'default:hello')
    expect(listInstalled(next, 'web').map((item) => item.pluginId)).toEqual(['default:other'])
  })
})
