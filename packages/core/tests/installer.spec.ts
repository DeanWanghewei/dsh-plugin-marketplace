import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  dshmPaths,
  installPlugin,
  loadStore,
  profileDir,
  uninstallPlugin,
  type InstallerDeps,
  type ResolvedPlugin,
} from '../src/index.js'
import { FakeRunner, makeTestEnv, type TestEnv } from './helpers.js'

function setup(): { env: TestEnv; runner: FakeRunner; deps: () => InstallerDeps } {
  const env = makeTestEnv()
  const runner = new FakeRunner()
  runner.on(
    (command) => command === 'dsh' || command === 'pnpm',
    () => ({ ok: true, stdout: '0.1.0\n', stderr: '' }),
  )
  const deps = () => ({
    runner,
    env: env.env,
    config: { defaultProfile: 'demo', registries: [], gitTokens: {} },
    paths: dshmPaths(env.dshmHome),
  })
  return { env, runner, deps }
}

function pathPlugin(id: string, path: string): ResolvedPlugin {
  return {
    registry: 'default',
    qualifiedId: `default:${id}`,
    entry: {
      id,
      name: id,
      description: '',
      categories: [],
      tags: [],
      verified: true,
      source: { type: 'path', path },
    },
  }
}

describe('installer — managed-row strategy (single-file path source)', () => {
  it('copies the entry, appends a managed block, and records state', async () => {
    const { env, runner, deps } = setup()
    const entry = join(env.dshmHome, 'hello.ts')
    runner.writeTextFile(entry, 'export function apply() {}\n')
    const profile = profileDir(env.dshHome, 'demo')
    runner.writeTextFile(join(profile, 'cordis.patch.yml'), '[]\n')

    const outcome = await installPlugin(deps(), pathPlugin('hello', entry), { profile: 'demo' })
    expect(outcome.status).toBe('installed')

    const copied = runner.readTextFile(join(profile, 'dshm/hello/index.ts'))
    expect(copied).toContain('apply')
    const patch = runner.readTextFile(join(profile, 'cordis.patch.yml'))!
    expect(patch).toContain('# >>> dshm:hello')
    expect(patch).toContain('name: "./dshm/hello/index.ts"')
    const store = loadStore(runner, dshmPaths(env.dshmHome))
    expect(store.profiles['demo']?.plugins[0]?.strategy).toBe('managed-row')
  })

  it('is idempotent on repeat installs', async () => {
    const { env, runner, deps } = setup()
    const entry = join(env.dshmHome, 'hello.ts')
    runner.writeTextFile(entry, 'export function apply() {}\n')
    const profile = profileDir(env.dshHome, 'demo')
    runner.writeTextFile(join(profile, 'cordis.patch.yml'), '[]\n')
    await installPlugin(deps(), pathPlugin('hello', entry), { profile: 'demo' })
    const again = await installPlugin(deps(), pathPlugin('hello', entry), { profile: 'demo' })
    expect(again.status).toBe('already-installed')
  })

  it('uninstall removes the block, the copy, and the record', async () => {
    const { env, runner, deps } = setup()
    const entry = join(env.dshmHome, 'hello.ts')
    runner.writeTextFile(entry, 'export function apply() {}\n')
    const profile = profileDir(env.dshHome, 'demo')
    runner.writeTextFile(
      join(profile, 'cordis.patch.yml'),
      '# mine\n- id: mine\n  name: ./mine.ts\n',
    )
    await installPlugin(deps(), pathPlugin('hello', entry), { profile: 'demo' })
    const outcome = await uninstallPlugin(deps(), 'default:hello', 'demo')
    expect(outcome.status).toBe('uninstalled')
    const patch = runner.readTextFile(join(profile, 'cordis.patch.yml'))!
    expect(patch).not.toContain('dshm:hello')
    expect(patch).toContain('- id: mine')
    expect(runner.exists(join(profile, 'dshm/hello'))).toBe(false)
    expect(loadStore(runner, dshmPaths(env.dshmHome)).profiles['demo']?.plugins).toHaveLength(0)
  })
})

describe('installer — pnpm strategy (npm source via fake dsh)', () => {
  it('delegates to dsh plugin add and records the resolved package', async () => {
    const { env, runner, deps } = setup()
    const seen: string[] = []
    runner.on(
      (command, args) => command === 'dsh' && args[0] === 'plugin' && args[3] === 'add',
      (args) => {
        seen.push(args[5]!)
        // Simulate dsh: install the dependency into the profile manifest.
        const profile = profileDir(env.dshHome, 'demo')
        runner.writeTextFile(
          join(profile, 'package.json'),
          JSON.stringify({ dependencies: { 'hello-pkg': '1.0.0' } }),
        )
        return { ok: true, stdout: 'Packages: +1\n', stderr: '' }
      },
    )
    const plugin: ResolvedPlugin = {
      registry: 'default',
      qualifiedId: 'default:hello',
      entry: {
        id: 'hello',
        name: 'hello',
        description: '',
        categories: [],
        tags: [],
        verified: true,
        source: { type: 'npm', package: 'hello-pkg' },
      },
    }
    const outcome = await installPlugin(deps(), plugin, { profile: 'demo' })
    expect(seen).toEqual(['hello-pkg'])
    expect(outcome.status).toBe('installed')
    if (outcome.status === 'installed') {
      expect(outcome.record.packageName).toBe('hello-pkg')
      expect(outcome.record.version.version).toBe('1.0.0')
      // No dsh.bundle declaration in the installed manifest → no activation row.
      expect(outcome.record.managed).toBeUndefined()
    }
  })

  it('activates bundle-less packages with a profile-patch row', async () => {
    const { env, runner, deps } = setup()
    runner.on(
      (command, args) => command === 'dsh' && args[0] === 'plugin' && args[3] === 'add',
      () => {
        const profile = profileDir(env.dshHome, 'demo')
        runner.writeTextFile(
          join(profile, 'package.json'),
          JSON.stringify({ dependencies: { 'hello-pkg': '1.0.0' } }),
        )
        // Old-style package on npm: no `dsh.bundle` declaration.
        runner.writeTextFile(
          join(profile, 'node_modules/hello-pkg/package.json'),
          JSON.stringify({ name: 'hello-pkg', version: '1.0.0' }),
        )
        return { ok: true, stdout: 'Packages: +1\n', stderr: '' }
      },
    )
    const plugin: ResolvedPlugin = {
      registry: 'default',
      qualifiedId: 'default:hello',
      entry: {
        id: 'hello',
        name: 'hello',
        description: '',
        categories: [],
        tags: [],
        verified: true,
        source: { type: 'npm', package: 'hello-pkg' },
      },
    }
    const outcome = await installPlugin(deps(), plugin, { profile: 'demo' })
    expect(outcome.status).toBe('installed')
    const profile = profileDir(env.dshHome, 'demo')
    const patch = runner.readTextFile(join(profile, 'cordis.patch.yml'))!
    expect(patch).toContain('# >>> dshm:hello')
    expect(patch).toContain('name: "hello-pkg"')
    // Uninstall drops both the row and the dependency record.
    const removed = await uninstallPlugin(deps(), 'default:hello', 'demo')
    expect(removed.status).toBe('uninstalled')
    expect(runner.readTextFile(join(profile, 'cordis.patch.yml'))).not.toContain('dshm:hello')
  })

  it('surfaces allowBuilds refusals for an explicit decision', async () => {
    const { env, runner, deps } = setup()
    runner.on(
      (command, args) => command === 'dsh' && args[0] === 'plugin' && args[3] === 'add',
      () => ({
        ok: false,
        stdout: 'Ignored build scripts: hello-pkg.\n',
        stderr: '',
      }),
    )
    const plugin: ResolvedPlugin = {
      registry: 'default',
      qualifiedId: 'default:hello',
      entry: {
        id: 'hello',
        name: 'hello',
        description: '',
        categories: [],
        tags: [],
        verified: true,
        source: { type: 'npm', package: 'hello-pkg' },
      },
    }
    const outcome = await installPlugin(deps(), plugin, { profile: 'demo' })
    expect(outcome.status).toBe('allow-builds-required')
    if (outcome.status === 'allow-builds-required') expect(outcome.keys).toEqual(['hello-pkg'])
    // No half-install state survives the refusal.
    const store = loadStore(runner, dshmPaths(env.dshmHome))
    expect(store.profiles['demo']).toBeUndefined()
    expect(store.pending['demo']).toBeUndefined()
  })
})
