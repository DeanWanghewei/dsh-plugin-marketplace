import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  dshmPaths,
  exportGroupYaml,
  findGroup,
  importGroupYaml,
  loadGroups,
  removeGroup,
  upsertGroup,
  type PluginGroup,
} from '../src/index.js'
import { FakeRunner } from './helpers.js'

const cleanups: Array<() => void> = []
afterAll(() => {
  for (const cleanup of cleanups) cleanup()
})

function makeSuite(): { runner: FakeRunner; home: string } {
  const base = mkdtempSync(join(tmpdir(), 'dshm-groups-'))
  cleanups.push(() => rmSync(base, { recursive: true, force: true }))
  return { runner: new FakeRunner(), home: join(base, 'home') }
}

const group: PluginGroup = {
  name: 'kit',
  description: 'daily set',
  plugins: ['tool-cordis', 'skill', 'timer'],
  profile: 'web',
  createdAt: '2026-08-19T00:00:00.000Z',
}

describe('plugin groups', () => {
  it('upsert/find/remove round-trips through disk', () => {
    const { runner, home } = makeSuite()
    const paths = dshmPaths(home)
    upsertGroup(runner, paths, group)
    expect(findGroup(runner, paths, 'kit')?.plugins).toEqual(group.plugins)
    upsertGroup(runner, paths, { ...group, description: 'v2' })
    const after = loadGroups(runner, paths)
    expect(after.groups).toHaveLength(1)
    expect(after.groups[0]?.description).toBe('v2')
    expect(removeGroup(runner, paths, 'kit')).toBe(true)
    expect(removeGroup(runner, paths, 'kit')).toBe(false)
  })

  it('export/import YAML round-trips a group', () => {
    const yaml = exportGroupYaml(group)
    const imported = importGroupYaml(yaml)
    if ('error' in imported) throw new Error(imported.error)
    expect(imported.name).toBe('kit')
    expect(imported.plugins).toEqual(group.plugins)
  })

  it('import rejects malformed documents with a clear error', () => {
    expect('error' in importGroupYaml('not: a group')).toBe(true)
    expect('error' in importGroupYaml('dshmGroup: { name: x }')).toBe(true)
  })
})
