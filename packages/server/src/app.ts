import { Hono, type Context, type Next } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { categoryDefSchema, parseRegistry, pluginEntrySchema, type PluginEntry } from '@dshm/core'
import type { RegistryRepo } from './repo.js'
import type { AuditLog, TokenIdentity, TokenStore } from './tokens.js'

export interface AppServices {
  repo: RegistryRepo
  tokens: TokenStore
  audit: AuditLog
  /** Name written into the exported registry document. */
  registryName: string
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 500

function pagination(url: URL): { limit: number; offset: number } {
  const limit = Math.min(Number(url.searchParams.get('limit')) || DEFAULT_LIMIT, MAX_LIMIT)
  const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0)
  return { limit, offset }
}

/** Bearer auth against hashed tokens; admin routes require an admin token. */
async function requireAdmin(services: AppServices, context: Context, next: Next) {
  const header = context.req.header('authorization') ?? ''
  const raw = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!raw) return context.json({ error: 'missing bearer token' }, 401)
  const identity: TokenIdentity | undefined = await services.tokens.verify(raw)
  if (!identity) return context.json({ error: 'invalid token' }, 401)
  if (!identity.admin) return context.json({ error: 'admin token required' }, 403)
  context.set('actor', identity.name)
  await next()
}

export function createApp(services: AppServices): Hono<{ Variables: { actor: string } }> {
  const app = new Hono<{ Variables: { actor: string } }>()

  app.get('/health', async (context) => {
    return context.json({ ok: true, plugins: await services.repo.countPlugins() })
  })

  app.get('/api/v1/plugins', async (context) => {
    const url = new URL(context.req.url)
    const { limit, offset } = pagination(url)
    const result = await services.repo.listPlugins({
      q: url.searchParams.get('q') ?? undefined,
      category: url.searchParams.get('category') ?? undefined,
      tag: url.searchParams.get('tag') ?? undefined,
      limit,
      offset,
    })
    return context.json(result)
  })

  app.get('/api/v1/plugins/:id', async (context) => {
    const plugin = await services.repo.getPlugin(context.req.param('id'))
    if (!plugin) return context.json({ error: 'not found' }, 404)
    return context.json(plugin)
  })

  app.get('/api/v1/categories', async (context) => {
    return context.json(await services.repo.listCategories())
  })

  // Download-counter reporting: best-effort, public, one row per install.
  app.post('/api/v1/plugins/:id/report-install', async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as {
      client?: string
      version?: string
    }
    const client = body.client === 'web' ? 'web' : 'cli'
    const recorded = await services.repo.reportDownload(
      context.req.param('id'),
      client,
      body.version,
    )
    if (!recorded) return context.json({ error: 'not found' }, 404)
    return context.json({ ok: true, ...recorded })
  })

  app.get('/api/v1/stats/downloads', async (context) => {
    const top = Math.min(Number(context.req.query('top')) || 20, 100)
    return context.json(await services.repo.statsDownloads(top))
  })

  // The document the CLI consumes directly: `dshm registry add team --url <here>`
  app.get('/api/v1/export', async (context) => {
    const data = await services.repo.exportRegistry(services.registryName)
    return context.body(`${stringifyYaml(data)}\n`, 200, {
      'content-type': 'application/yaml; charset=utf-8',
    })
  })

  const admin = new Hono<{ Variables: { actor: string } }>()
  admin.use('*', (context, next) => requireAdmin(services, context, next))

  admin.put('/plugins/:id', async (context) => {
    const body = await context.req.json().catch(() => undefined)
    const parsed = pluginEntrySchema.safeParse({ ...body, id: context.req.param('id') })
    if (!parsed.success) {
      return context.json({ error: 'invalid plugin entry', issues: parsed.error.issues }, 400)
    }
    const entry: PluginEntry = parsed.data
    await services.repo.upsertPlugin(entry)
    await services.audit.record(context.get('actor'), 'plugin.upsert', entry.id)
    return context.json({ ok: true, plugin: entry }, 201)
  })

  admin.delete('/plugins/:id', async (context) => {
    const id = context.req.param('id')
    const removed = await services.repo.deletePlugin(id)
    await services.audit.record(context.get('actor'), 'plugin.delete', id)
    return context.json({ ok: removed })
  })

  admin.put('/categories/:id', async (context) => {
    const body = await context.req.json().catch(() => undefined)
    const parsed = categoryDefSchema.safeParse({ ...body, id: context.req.param('id') })
    if (!parsed.success) {
      return context.json({ error: 'invalid category', issues: parsed.error.issues }, 400)
    }
    const category = parsed.data
    await services.repo.upsertCategory(category)
    await services.audit.record(context.get('actor'), 'category.upsert', category.id)
    return context.json({ ok: true, category }, 201)
  })

  admin.delete('/categories/:id', async (context) => {
    const id = context.req.param('id')
    const removed = await services.repo.deleteCategory(id)
    await services.audit.record(context.get('actor'), 'category.delete', id)
    return context.json({ ok: removed })
  })

  // Body: a registry.yaml document (YAML or JSON), ?mode=replace|merge
  admin.post('/import', async (context) => {
    const text = await context.req.text()
    let document: unknown
    try {
      document = JSON.parse(text)
    } catch {
      try {
        document = parseYaml(text)
      } catch {
        return context.json({ error: 'unparsable body' }, 400)
      }
    }
    const result = parseRegistry(document as Record<string, unknown>)
    if (!result.ok) return context.json({ error: result.error }, 400)
    const mode = context.req.query('mode') === 'merge' ? 'merge' : 'replace'
    const summary = await services.repo.importRegistry(result.data, mode)
    await services.audit.record(
      context.get('actor'),
      'registry.import',
      mode,
      `${summary.plugins} plugins`,
    )
    return context.json({ ok: true, ...summary, mode })
  })

  admin.get('/tokens', async (context) => {
    return context.json(await services.tokens.list())
  })

  admin.post('/tokens', async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as {
      name?: string
      admin?: boolean
    }
    if (!body.name) return context.json({ error: 'name required' }, 400)
    const token = await services.tokens.create(body.name, body.admin === true)
    await services.audit.record(context.get('actor'), 'token.create', body.name)
    return context.json({ ok: true, name: body.name, token }, 201)
  })

  admin.delete('/tokens/:name', async (context) => {
    const name = context.req.param('name')
    const revoked = await services.tokens.revoke(name)
    await services.audit.record(context.get('actor'), 'token.revoke', name)
    return context.json({ ok: revoked })
  })

  admin.get('/audit', async (context) => {
    const limit = Math.min(Number(context.req.query('limit')) || 50, 500)
    return context.json(await services.audit.list(limit))
  })

  app.route('/api/v1/admin', admin)

  // Static web UI (marketplace + admin SPA), shipped inside the image at
  // ./web. Registered last so /api and /health always win; unknown paths fall
  // back to index.html for client-side routing.
  app.use('*', serveStatic({ root: './web' }))
  app.get('*', serveStatic({ root: './web', path: '/index.html' }))

  return app
}
