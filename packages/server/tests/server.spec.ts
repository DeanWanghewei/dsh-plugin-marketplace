import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { stringify } from 'yaml'
import { openDatabase, type SqlDriver } from '../src/driver.js'
import { RegistryRepo } from '../src/repo.js'
import { AuditLog, TokenStore } from '../src/tokens.js'
import { createApp } from '../src/app.js'

const MYSQL_URL = process.env['DSHM_TEST_MYSQL_URL']
const tempDirs: string[] = []

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

interface PluginList {
  total: number
  items: Array<{ id: string }>
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

async function makeSuite(location: string) {
  const driver: SqlDriver = await openDatabase(location)
  const repo = new RegistryRepo(driver)
  const tokens = new TokenStore(driver)
  const audit = new AuditLog(driver)
  const app = createApp({ repo, driver, tokens, audit, registryName: 'test' })
  const adminToken = await tokens.create('test-admin', true)
  const readToken = await tokens.create('test-read', false)
  const auth = (token: string) => ({ authorization: `Bearer ${token}` })
  return { driver, repo, app, adminToken, readToken, auth }
}

const registryDoc = {
  schemaVersion: 1,
  name: 'test',
  categories: [
    { id: 'tool', name: { zh: '工具', en: 'Tool' }, parent: null },
    { id: 'ui', name: { en: 'UI' }, parent: null },
  ],
  plugins: [
    {
      id: 'alpha',
      name: 'Alpha 工具',
      description: 'first test plugin',
      categories: ['tool'],
      tags: ['core'],
      verified: true,
      images: [],
      source: { type: 'npm', package: 'alpha-pkg' },
    },
    {
      id: 'beta',
      name: 'Beta UI',
      description: 'second test plugin',
      categories: ['ui', 'tool'],
      tags: ['web'],
      source: { type: 'git', url: 'github:x/beta' },
    },
  ],
}

function suite(label: string, location: () => string) {
  describe.sequential(label, () => {
    let suite: Awaited<ReturnType<typeof makeSuite>>

    beforeAll(async () => {
      suite = await makeSuite(location())
      await suite.repo.importRegistry(registryDoc as never, 'replace')
    })

    it('health reports plugin count', async () => {
      const response = await suite.app.request('/health')
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ ok: true, plugins: 2 })
    })

    it('lists and searches plugins with filters', async () => {
      const all = await json<PluginList>(await suite.app.request('/api/v1/plugins'))
      expect(all).toMatchObject({ total: 2 })
      const search = await json<PluginList>(await suite.app.request('/api/v1/plugins?q=alpha'))
      expect(search.total).toBe(1)
      expect(search.items[0]).toMatchObject({ id: 'alpha' })
      const byCategory = await json<PluginList>(
        await suite.app.request('/api/v1/plugins?category=ui'),
      )
      expect(byCategory.total).toBe(1)
      expect(byCategory.items[0]).toMatchObject({ id: 'beta' })
    })

    it('searches CJK names', async () => {
      const search = await json<PluginList>(await suite.app.request('/api/v1/plugins?q=工具'))
      expect(search.total).toBeGreaterThanOrEqual(1)
    })

    it('categories include multi-membership counts', async () => {
      const categories = await json<Array<{ id: string; count: number }>>(
        await suite.app.request('/api/v1/categories'),
      )
      const tool = categories.find((entry) => entry.id === 'tool')
      const ui = categories.find((entry) => entry.id === 'ui')
      expect(tool?.count).toBe(2)
      expect(ui?.count).toBe(1)
    })

    it('export round-trips into the registry.yaml the CLI parses', async () => {
      const response = await suite.app.request('/api/v1/export')
      expect(response.status).toBe(200)
      const text = await response.text()
      const { parseRegistry } = await import('@dshm/core')
      const parsed = parseRegistry((await import('yaml')).parse(text))
      expect(parsed.ok).toBe(true)
      if (parsed.ok) {
        expect(parsed.data.plugins).toHaveLength(2)
        expect(parsed.data.plugins.map((plugin) => plugin.id).sort()).toEqual(['alpha', 'beta'])
      }
    })

    it('rejects admin routes without a token and with a read-only token', async () => {
      expect((await suite.app.request('/api/v1/admin/tokens')).status).toBe(401)
      expect(
        (await suite.app.request('/api/v1/admin/tokens', { headers: suite.auth(suite.readToken) }))
          .status,
      ).toBe(403)
    })

    it('admin can upsert, read, and delete a plugin', async () => {
      const put = await suite.app.request('/api/v1/admin/plugins/gamma', {
        method: 'PUT',
        headers: { ...suite.auth(suite.adminToken), 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Gamma',
          categories: ['tool'],
          source: { type: 'path', path: '/tmp/gamma' },
        }),
      })
      expect(put.status).toBe(201)
      const fetched = await (await suite.app.request('/api/v1/plugins/gamma')).json()
      expect(fetched).toMatchObject({ name: 'Gamma', verified: false })

      const removed = await suite.app.request('/api/v1/admin/plugins/gamma', {
        method: 'DELETE',
        headers: suite.auth(suite.adminToken),
      })
      expect(await removed.json()).toMatchObject({ ok: true })
      expect((await suite.app.request('/api/v1/plugins/gamma')).status).toBe(404)
    })

    it('import merge keeps existing plugins and adds new ones', async () => {
      const doc = {
        schemaVersion: 1,
        name: 'test',
        categories: registryDoc.categories,
        plugins: [
          {
            id: 'delta',
            name: 'Delta',
            categories: ['tool'],
            source: { type: 'npm', package: 'delta-pkg' },
          },
        ],
      }
      const response = await suite.app.request('/api/v1/admin/import?mode=merge', {
        method: 'POST',
        headers: { ...suite.auth(suite.adminToken), 'content-type': 'application/yaml' },
        body: stringify(doc),
      })
      expect(response.status).toBe(200)
      const health = await json<{ plugins: number }>(await suite.app.request('/health'))
      expect(health.plugins).toBe(3)
    })

    it('token lifecycle: create via API, list, revoke', async () => {
      const created = await suite.app.request('/api/v1/admin/tokens', {
        method: 'POST',
        headers: { ...suite.auth(suite.adminToken), 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'ci-token', admin: false }),
      })
      const body = (await created.json()) as { token: string }
      expect(body.token).toBeTruthy()
      const list = await json<Array<{ name: string }>>(
        await suite.app.request('/api/v1/admin/tokens', { headers: suite.auth(suite.adminToken) }),
      )
      expect(list.some((row) => row.name === 'ci-token')).toBe(true)
      const revoked = await suite.app.request('/api/v1/admin/tokens/ci-token', {
        method: 'DELETE',
        headers: suite.auth(suite.adminToken),
      })
      expect(await revoked.json()).toMatchObject({ ok: true })
    })

    it('audit log records admin mutations', async () => {
      const entries = await json<Array<{ action: string }>>(
        await suite.app.request('/api/v1/admin/audit', { headers: suite.auth(suite.adminToken) }),
      )
      const actions = entries.map((entry) => entry.action)
      expect(actions).toContain('plugin.upsert')
      expect(actions).toContain('registry.import')
    })
  })
}

function sqliteLocation(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dshm-server-test-'))
  tempDirs.push(dir)
  return join(dir, 'registry.db')
}

suite('registry server (sqlite)', sqliteLocation)
if (MYSQL_URL) suite('registry server (mysql)', () => MYSQL_URL)
