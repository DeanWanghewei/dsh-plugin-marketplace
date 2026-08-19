import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDatabase, type SqlDriver } from '../src/driver.js'
import { RegistryRepo } from '../src/repo.js'
import { AuditLog, TokenStore } from '../src/tokens.js'
import { createApp } from '../src/app.js'
import { stringify } from 'yaml'

const tempDirs: string[] = []
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

const MYSQL_URL = process.env['DSHM_TEST_MYSQL_URL']

function sqliteLocation(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dshm-gallery-test-'))
  tempDirs.push(dir)
  return join(dir, 'registry.db')
}

async function makeSuite(location: string) {
  const driver: SqlDriver = await openDatabase(location)
  const repo = new RegistryRepo(driver)
  const tokens = new TokenStore(driver)
  const audit = new AuditLog(driver)
  const app = createApp({ repo, driver, tokens, audit, registryName: 'test' })
  const adminToken = await tokens.create('gallery-admin', true)
  const auth = { authorization: `Bearer ${adminToken}` }
  return { driver, app, auth }
}

function suite(label: string, location: () => string) {
  describe.sequential(label, () => {
    let test: Awaited<ReturnType<typeof makeSuite>>

    beforeAll(async () => {
      test = await makeSuite(location())
      await test.app.request('/api/v1/admin/import?mode=replace', {
        method: 'POST',
        headers: { ...test.auth, 'content-type': 'application/yaml' },
        body: stringify({
          schemaVersion: 1,
          name: 'test',
          categories: [{ id: 'tool', name: { en: 'Tool' }, parent: null }],
          plugins: [
            {
              id: 'alpha',
              name: 'Alpha',
              categories: ['tool'],
              source: { type: 'npm', package: 'alpha-pkg' },
              images: [
                { url: 'https://github.com/user/repo/assets/shot-1.png', caption: '主界面' },
                { url: 'https://s3.example.com/alpha/shot-2.png' },
              ],
            },
            {
              id: 'beta',
              name: 'Beta',
              categories: ['tool'],
              source: { type: 'git', url: 'github:x/beta' },
            },
          ],
        }),
      })
    })

    it('serves images metadata on list and detail', async () => {
      const detail = (await (
        await test.app.request('/api/v1/plugins/alpha')
      ).json()) as { images: Array<{ url: string; caption?: string }>; downloads: number }
      expect(detail.images).toHaveLength(2)
      expect(detail.images[0]).toMatchObject({
        url: 'https://github.com/user/repo/assets/shot-1.png',
        caption: '主界面',
      })
      expect(detail.downloads).toBe(0)
    })

    it('report-install counts per plugin and dimension', async () => {
      const first = await test.app.request('/api/v1/plugins/alpha/report-install', {
        method: 'POST',
        body: JSON.stringify({ client: 'cli', version: '1.0.0' }),
        headers: { 'content-type': 'application/json' },
      })
      expect(first.status).toBe(200)
      await test.app.request('/api/v1/plugins/alpha/report-install', {
        method: 'POST',
        body: JSON.stringify({ client: 'web' }),
        headers: { 'content-type': 'application/json' },
      })
      await test.app.request('/api/v1/plugins/beta/report-install', {
        method: 'POST',
        body: JSON.stringify({ client: 'cli' }),
        headers: { 'content-type': 'application/json' },
      })
      const afterReports = (await (await test.app.request('/api/v1/plugins/alpha')).json()) as {
        downloads: number
      }
      expect(afterReports.downloads).toBe(2)

      const stats = (await (await test.app.request('/api/v1/stats/downloads')).json()) as {
        total: number
        top: Array<{ id: string; downloads: number }>
        byClient: Array<{ client: string; downloads: number }>
        bySource: Array<{ source_type: string; downloads: number }>
      }
      expect(stats.total).toBe(3)
      expect(stats.top[0]).toMatchObject({ id: 'alpha', downloads: 2 })
      expect((stats.byClient.find((row) => row.client === 'cli')?.downloads ?? -1)).toBe(2)
      expect((stats.bySource.find((row) => row.source_type === 'npm')?.downloads ?? -1)).toBe(2)
      expect((stats.bySource.find((row) => row.source_type === 'git')?.downloads ?? -1)).toBe(1)
    })

    it('report-install 404s for unknown plugins', async () => {
      expect(
        (
          await test.app.request('/api/v1/plugins/ghost/report-install', {
            method: 'POST',
            body: '{}',
          })
        ).status,
      ).toBe(404)
    })

    it('export yaml omits serving-time aggregates but keeps images', async () => {
      const text = await (await test.app.request('/api/v1/export')).text()
      expect(text).not.toContain('downloads')
      expect(text).toContain('shot-1.png')
    })

    it('migrations are idempotent on reopen', async () => {
      const { driver } = test
      await driver.close()
      const reopened = await makeSuite(location())
      expect((await reopened.app.request('/health')).status).toBe(200)
      await reopened.driver.close()
    })
  })
}

suite('gallery + stats (sqlite)', sqliteLocation)
if (MYSQL_URL) suite('gallery + stats (mysql)', () => MYSQL_URL)
