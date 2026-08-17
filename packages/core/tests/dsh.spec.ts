import { describe, expect, it } from 'vitest'
import { parseAllowBuildsKeys, writeAllowBuilds } from '../src/index.js'
import { FakeRunner, makeTestEnv } from './helpers.js'

describe('parseAllowBuildsKeys', () => {
  it('extracts packages from pnpm ≥10 refusal output', () => {
    const output = [
      'Ignored build scripts: dsh-hello-plugin.',
      'Run "pnpm approve-builds" to pick which dependencies should be allowed to run scripts.',
    ].join('\n')
    expect(parseAllowBuildsKeys(output)).toEqual(['dsh-hello-plugin'])
  })

  it('extracts several packages', () => {
    expect(parseAllowBuildsKeys('Ignored build scripts: a, b, c.')).toEqual(['a', 'b', 'c'])
  })

  it('returns empty for unrelated failures', () => {
    expect(parseAllowBuildsKeys('ERR_PNPM_NO_MATCHING_VERSION foo@999')).toEqual([])
    expect(parseAllowBuildsKeys('')).toEqual([])
  })
})

describe('writeAllowBuilds', () => {
  it('upserts allowBuilds into the profile pnpm-workspace.yaml', () => {
    const { dshHome } = makeTestEnv()
    const runner = new FakeRunner()
    const profileDir = `${dshHome}/profiles/demo`
    runner.writeTextFile(`${profileDir}/pnpm-workspace.yaml`, 'allowBuilds:\n  existing: true\n')
    writeAllowBuilds(runner, profileDir, ['dsh-hello-plugin'])
    const next = runner.readTextFile(`${profileDir}/pnpm-workspace.yaml`)!
    expect(next).toContain('existing: true')
    expect(next).toContain('dsh-hello-plugin: true')
  })

  it('creates the file when missing', () => {
    const { dshHome } = makeTestEnv()
    const runner = new FakeRunner()
    const profileDir = `${dshHome}/profiles/demo`
    writeAllowBuilds(runner, profileDir, ['x'])
    expect(runner.readTextFile(`${profileDir}/pnpm-workspace.yaml`)).toContain('x: true')
  })
})
