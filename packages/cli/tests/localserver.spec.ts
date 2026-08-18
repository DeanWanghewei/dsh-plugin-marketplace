import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { stringify } from 'yaml'
import { FakeRunner } from './fake-runner.js'
import { createLocalApp } from '../src/localserver.js'

const hasWebAssets = existsSync('web/local.html')

const cleanups: Array<() => void> = []
afterAll(() => {
  for (const cleanup of cleanups) cleanup()
})

function makeEnv(): { env: NodeJS.ProcessEnv; runner: FakeRunner } {
  const base = mkdtempSync(join(tmpdir(), 'dshm-localui-'))
  cleanups.push(() => rmSync(base, { recursive: true, force: true }))
  return {
    env: {
      HOME: base,
      DSH_HOME: join(base, '.dsh'),
      DSHM_HOME: join(base, '.dshm'),
      PATH: process.env['PATH'] ?? '',
    },
    runner: new FakeRunner(),
  }
}

describe('dshm web local console', () => {
  it('serves config, profiles, and aggregated plugins from all registries', async () => {
    const { env, runner } = makeEnv()
    const app = createLocalApp(runner, env)

    const config = (await (await app.request('/api/local/config')).json()) as {
      defaultProfile: string
    }
    expect(config.defaultProfile).toBe('web')

    const profiles = (await (await app.request('/api/local/profiles')).json()) as {
      items: string[]
    }
    expect(profiles.items).toContain('web')

    const list = (await (await app.request('/api/local/plugins?profile=web')).json()) as {
      items: Array<{ registry: string }>
    }
    expect(list.items.length).toBeGreaterThan(100)
    expect(list.items[0]).toMatchObject({ registry: 'default', installed: false })

    const registries = (await (await app.request('/api/local/registries')).json()) as {
      items: Array<{ name: string; type: string }>
    }
    expect(registries.items[0]).toMatchObject({ name: 'default', type: 'file' })
  })

  it.skipIf(!hasWebAssets)('serves the LOCAL console at / and 404s unknown API paths', async () => {
    const { env, runner } = makeEnv()
    const app = createLocalApp(runner, env)

    const home = await app.request('/')
    const html = await home.text()
    expect(home.status).toBe(200)
    expect(html).toContain('本地控制台')
    expect(html).not.toContain('插件市场') // the server SPA must not leak in

    const unknown = await app.request('/api/does-not-exist')
    expect(unknown.status).toBe(404)
    expect(unknown.headers.get('content-type')).toContain('application/json')
  })

  it('add/remove a file marketplace through the API', async () => {
    const { env, runner } = makeEnv()
    const app = createLocalApp(runner, env)

    const doc = stringify({
      schemaVersion: 1,
      name: 'extra',
      categories: [{ id: 't', name: { en: 'T' }, parent: null }],
      plugins: [
        { id: 'one', name: 'One', categories: ['t'], source: { type: 'npm', package: 'one-pkg' } },
      ],
    })
    const file = join(env['DSHM_HOME']!, 'extra.yaml')
    runner.writeTextFile(file, doc)

    const added = (await (
      await app.request('/api/local/registries', {
        method: 'POST',
        body: JSON.stringify({ name: 'extra', type: 'file', value: file }),
      })
    ).json()) as { ok: boolean }
    expect(added.ok).toBe(true)

    const list = (await (await app.request('/api/local/plugins?profile=web')).json()) as {
      items: Array<{ registry: string; installed: boolean }>
    }
    expect(list.items.some((item: { registry: string }) => item.registry === 'extra')).toBe(true)

    const removed = (await (
      await app.request('/api/local/registries/extra', { method: 'DELETE' })
    ).json()) as { ok: boolean }
    expect(removed.ok).toBe(true)
  })
})
