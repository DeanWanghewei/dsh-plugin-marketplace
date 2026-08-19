import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { stringify } from 'yaml'
import {
  handleInfo,
  handleInstall,
  handleListInstalled,
  handleSearch,
  handleUninstall,
} from '../src/handlers.js'

const cleanups: Array<() => void> = []
const previousEnv: Record<string, string | undefined> = {}

beforeAll(() => {
  // Deterministic isolated home BEFORE any test can run (shuffle-safe, and
  // never touches the developer's real ~/.dshm). The curated git source is
  // disabled: its clone depends on network reachability and must not make
  // unit tests flaky.
  for (const key of ['DSHM_HOME', 'DSH_HOME', 'PATH', 'DSHM_CURATED_URL', 'DSHM_NPM_SCAN']) {
    previousEnv[key] = process.env[key]
  }
  process.env['DSHM_CURATED_URL'] = 'none'
  process.env['DSHM_NPM_SCAN'] = 'none'
  const base = mkdtempSync(join(tmpdir(), 'dshm-plugin-'))
  cleanups.push(() => rmSync(base, { recursive: true, force: true }))
  process.env['DSHM_HOME'] = join(base, '.dshm')
  process.env['DSH_HOME'] = join(base, '.dsh')
  // CI machines have no dsh/pnpm: provide no-op shims so the install
  // round-trip exercises the managed-row flow without a real harness.
  const bin = join(base, 'bin')
  mkdirSync(bin, { recursive: true })
  for (const name of ['dsh', 'pnpm', 'which']) {
    writeFileSync(join(bin, name), '#!/bin/sh\necho "0.1.0"\n')
    chmodSync(join(bin, name), 0o755)
  }
  process.env['PATH'] = `${bin}:${process.env['PATH']}`
})

afterAll(() => {
  for (const cleanup of cleanups) cleanup()
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe.sequential('dshm plugin handlers', () => {
  it('search answers over the bundled registry', async () => {
    const output = await handleSearch({ query: 'cordis', limit: 5 })
    expect(output).toContain('plugins:')
    expect(output).toContain('cordis-host-runner')
  })

  it('info reports install state for a profile', async () => {
    const output = await handleInfo('tool-cordis')
    expect(output).toContain('dsh-tool-cordis')
    expect(output).toContain("installed in 'web': no")
  })

  it('install/uninstall round-trip of a single-file plugin', async () => {
    const entryFile = join(process.env['DSHM_HOME']!, 'hello.js')
    const { writeFileSync, mkdirSync } = await import('node:fs')
    mkdirSync(join(process.env['DSH_HOME']!, 'profile-seed'), { recursive: true })
    writeFileSync(entryFile, 'export function apply() {}\n')
    // A file-source registry plus a bootstrapped profile directory.
    writeFileSync(
      join(process.env['DSHM_HOME']!, 'config.yaml'),
      stringify({
        defaultProfile: 'demo',
        registries: [
          {
            name: 'local',
            type: 'file',
            path: join(process.env['DSHM_HOME']!, 'registry.yaml'),
          },
        ],
        gitTokens: {},
      }),
    )
    writeFileSync(
      join(process.env['DSHM_HOME']!, 'registry.yaml'),
      stringify({
        schemaVersion: 1,
        name: 'local',
        categories: [],
        plugins: [
          {
            id: 'hello',
            name: 'Hello',
            description: '',
            categories: [],
            tags: [],
            verified: true,
            source: { type: 'path', path: entryFile },
            images: [],
          },
        ],
      }),
    )
    const profileDir = join(process.env['DSH_HOME']!, 'profiles/demo')
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n')

    const installed = await handleInstall('hello', { profile: 'demo' })
    expect(installed).toContain('installed local:hello')
    expect(installed).toContain('managed-row')

    const listed = await handleListInstalled('demo')
    expect(listed).toContain('local:hello')

    const removed = await handleUninstall('hello', 'demo')
    expect(removed).toContain('uninstalled hello')
    const after = await handleListInstalled('demo')
    expect(after).toContain('nothing installed')
  })

  it('uninstall of something dshm did not install explains the boundary', async () => {
    const output = await handleUninstall('some-plugin', 'demo')
    expect(output).toContain('not installed')
  })
})
