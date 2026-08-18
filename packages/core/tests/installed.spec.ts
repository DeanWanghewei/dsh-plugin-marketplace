import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { installedView, qualifiedId, type ResolvedPlugin } from '../src/index.js'
import { FakeRunner, makeTestEnv } from './helpers.js'

function npmPlugin(registry: string, id: string, pkg: string): ResolvedPlugin {
  return {
    registry,
    qualifiedId: qualifiedId(registry, id),
    entry: {
      id,
      name: id,
      description: '',
      categories: [],
      tags: [],
      verified: true,
      source: { type: 'npm', package: pkg },
      images: [],
    },
  }
}

describe('installed view (dshm store ∪ profile packages)', () => {
  it('marks in-box bundles and manual deps as installed via profile', () => {
    const { env, dshHome } = makeTestEnv()
    const runner = new FakeRunner()
    const profileDir = join(dshHome, 'profiles/web')
    // What a stock `web` profile looks like: in-box bundles plus a manual dep.
    runner.writeTextFile(
      join(profileDir, 'package.json'),
      JSON.stringify({
        dependencies: { 'hello-manual': '1.0.0' },
        dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
      }),
    )

    const plugins = [
      npmPlugin('default', 'base', '@deepseek-ai/dsh-base'),
      npmPlugin('default', 'web-app', '@deepseek-ai/dsh-web-app'),
      npmPlugin('default', 'manual', 'hello-manual'),
      npmPlugin('default', 'other', 'not-installed-pkg'),
    ]
    const view = installedView(runner, env, 'web', plugins, [
      // dshm installed this one itself; store record wins.
      {
        pluginId: 'default:manual',
        packageName: 'hello-manual',
        version: { version: '1.0.0' },
      },
    ])

    expect(view.get('default:base')).toMatchObject({ kind: 'profile' })
    expect(view.get('default:web-app')).toMatchObject({ kind: 'profile' })
    expect(view.get('default:manual')).toMatchObject({ kind: 'dshm' })
    expect(view.has('default:other')).toBe(false)
    expect(view.size).toBe(3)
  })

  it('empty store and empty profile yield nothing', () => {
    const { env } = makeTestEnv()
    const runner = new FakeRunner()
    const plugins = [npmPlugin('default', 'x', 'x-pkg')]
    const view = installedView(runner, env, 'web', plugins, [])
    expect(view.size).toBe(0)
  })

  it('path-sourced plugins match by the manifest name in their directory', () => {
    const { env } = makeTestEnv()
    const runner = new FakeRunner()
    const pkgDir = join(env['DSHM_HOME']!, 'checkout/base')
    runner.writeTextFile(
      join(pkgDir, 'package.json'),
      JSON.stringify({ name: '@deepseek-ai/dsh-base' }),
    )
    const plugin: ResolvedPlugin = {
      registry: 'default',
      qualifiedId: 'default:base',
      entry: {
        id: 'base',
        name: 'base',
        description: '',
        categories: [],
        tags: [],
        verified: true,
        source: { type: 'path', path: pkgDir },
        images: [],
      },
    }
    const profileDir = join(env['DSH_HOME']!, 'profiles/web')
    runner.writeTextFile(
      join(profileDir, 'package.json'),
      JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }),
    )
    const view = installedView(runner, env, 'web', [plugin], [])
    expect(view.get('default:base')).toMatchObject({
      kind: 'profile',
      packageName: '@deepseek-ai/dsh-base',
    })
  })

  it('git-sourced plugins match by repo-derived package name', () => {
    const { env } = makeTestEnv()
    const runner = new FakeRunner()
    const plugin: ResolvedPlugin = {
      registry: 'default',
      qualifiedId: 'default:turtle',
      entry: {
        id: 'turtle',
        name: 'turtle',
        description: '',
        categories: [],
        tags: [],
        verified: false,
        source: { type: 'git', url: 'github:deepseek-harness/turtle-ui' },
        images: [],
      },
    }
    const profileDir = join(env['DSH_HOME']!, 'profiles/web')
    runner.writeTextFile(
      join(profileDir, 'package.json'),
      JSON.stringify({ dependencies: { 'turtle-ui': 'github:deepseek-harness/turtle-ui#main' } }),
    )
    const view = installedView(runner, env, 'web', [plugin], [])
    expect(view.get('default:turtle')).toMatchObject({ kind: 'profile', packageName: 'turtle-ui' })
  })
})
