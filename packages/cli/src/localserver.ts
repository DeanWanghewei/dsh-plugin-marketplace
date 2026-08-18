import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { profileDir, resolveDshHome, hasBlock } from '@dshm/core'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono, type Handler } from 'hono'
import {
  installPlugin,
  installedView,
  directProfilePackages,
  uncatalogedPackages,
  loadConfig,
  loadRegistries,
  loadStore,
  listInstalled,
  NodeRunner,
  saveConfig,
  uninstallPlugin,
  enablePlugin,
  disablePlugin,
  type InstallerDeps,
  type RegistryRef,
  type ResolvedPlugin,
} from '@dshm/core'

/**
 * `dshm web` — a throwaway local console over THIS machine's view: every
 * configured marketplace merged, with install/uninstall bridged to the same
 * core installer the CLI uses. Binds 127.0.0.1 on a random free port, opens
 * the browser, and dies with the foreground process (Ctrl+C).
 */

function webRoot(): string {
  // Repo checkout (dist copied next to the package) or installed package.
  const here = dirname(fileURLToPath(import.meta.url))
  for (const candidate of [resolve(here, '../web'), resolve(here, '../../web')]) {
    if (existsSync(join(candidate, 'local.html'))) return candidate
  }
  return ''
}

export function createLocalApp(runner: NodeRunner, env: NodeJS.ProcessEnv) {
  const { config, paths } = loadConfig(runner, env)
  const deps: InstallerDeps = { runner, env, config, paths }

  const app = new Hono()

  app.get('/api/local/config', async (context) => {
    return context.json({ defaultProfile: config.defaultProfile })
  })

  app.get('/api/local/plugins', async (context) => {
    const profile = context.req.query('profile') ?? config.defaultProfile
    const merged = await loadRegistries(runner, config, paths.cacheDir)
    // Installed = dshm records ∪ packages the profile actually holds
    // (in-box bundles and manual installs live in the profile manifest).
    const view = installedView(
      runner,
      env,
      profile,
      merged.plugins,
      listInstalled(loadStore(runner, paths), profile),
    )
    const items = merged.plugins.map((plugin: ResolvedPlugin) => {
      const origin = view.get(plugin.qualifiedId)
      // Row state for dshm-managed installs: check the patch file for
      // disabled flag on this plugin's managed row.
      let rowState: string | undefined
      if (origin?.kind === 'dshm') {
        const profileDirectory = profileDir(resolveDshHome(env), profile)
        const patchContent = runner.readTextFile(join(profileDirectory, 'cordis.patch.yml'))
        if (patchContent !== undefined && hasBlock(patchContent, plugin.entry.id)) {
          const body = patchContent
            .split('\n')
            .slice(
              (patchContent.split('\n').findIndex((l) => l.trim() === `# >>> dshm:${plugin.entry.id}`) ?? -1) + 1,
              patchContent.split('\n').findIndex((l) => l.trim() === `# <<< dshm:${plugin.entry.id}`) ?? -1,
            )
            .join('\n')
          rowState = /^\s*disabled:\s*true/m.test(body) ? 'disabled' : 'enabled'
        }
      }
      return {
        ...plugin.entry,
        qualifiedId: plugin.qualifiedId,
        registry: plugin.registry,
        installed: origin !== undefined,
        origin: origin?.kind,
        rowState,
      }
    })
    // Uncataloged: packages the profile holds that no registry indexes.
    // Synthesized rows keep them visible and uninstallable.
    for (const uncataloged of uncatalogedPackages(
      runner,
      directProfilePackages(runner, env, profile),
      merged.plugins,
    )) {
      items.push({
        id: uncataloged.packageName,
        qualifiedId: `uncataloged:${uncataloged.packageName}`,
        registry: 'uncataloged',
        name: uncataloged.packageName,
        categories: [],
        tags: [],
        verified: false,
        source: { type: 'npm', package: uncataloged.packageName },
        images: [],
        rowState: undefined,
        installed: true,
        origin: 'profile' as const,
        description: `（registry 未收录 · 本机已安装 ${uncataloged.version}）`,
      })
    }
    return context.json({ items })
  })

  app.get('/api/local/registries', async (context) => {
    const merged = await loadRegistries(runner, config, paths.cacheDir)
    const items = config.registries.map((ref: RegistryRef) => {
      const error = merged.errors.find((entry) => entry.registry === ref.name)
      const loaded = merged.registries.find((entry) => entry.ref.name === ref.name)
      return {
        name: ref.name,
        type: ref.type,
        location: ref.path ?? ref.url ?? '—',
        ok: !error,
        error: error?.message,
        plugins: loaded?.data.plugins.length ?? 0,
      }
    })
    return context.json({ items })
  })

  app.post('/api/local/registries', async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as {
      name?: string
      type?: string
      value?: string
    }
    if (!body.name || !body.value) return context.json({ error: 'name and value required' }, 400)
    if (config.registries.some((ref: RegistryRef) => ref.name === body.name)) {
      return context.json({ error: `registry '${body.name}' already exists` }, 400)
    }
    const ref: RegistryRef =
      body.type === 'git'
        ? { name: body.name, type: 'git', url: body.value, subpath: 'registry.yaml' }
        : body.type === 'file'
          ? { name: body.name, type: 'file', path: body.value }
          : { name: body.name, type: 'http', url: body.value }
    config.registries.push(ref)
    saveConfig(runner, paths, config)
    // Load eagerly so the caller sees whether the new source actually works.
    const merged = await loadRegistries(runner, config, paths.cacheDir, { forceRefresh: true })
    const error = merged.errors.find((entry) => entry.registry === body.name)
    if (error) return context.json({ ok: true, warning: error.message })
    return context.json({ ok: true })
  })

  app.delete('/api/local/registries/:name', async (context) => {
    const name = context.req.param('name')
    const before = config.registries.length
    config.registries = config.registries.filter((ref: RegistryRef) => ref.name !== name)
    if (config.registries.length === before) {
      return context.json({ error: `registry '${name}' not found` }, 404)
    }
    saveConfig(runner, paths, config)
    return context.json({ ok: true })
  })

  app.get('/api/local/profiles', async (context) => {
    const store = loadStore(runner, paths)
    const names = new Set<string>([config.defaultProfile, ...Object.keys(store.profiles)])
    return context.json({ items: [...names] })
  })

  app.post('/api/local/install', async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as {
      qualifiedId?: string
      profile?: string
      allowBuild?: boolean
      yes?: boolean
    }
    const merged = await loadRegistries(runner, config, paths.cacheDir)
    const resolved = merged.plugins.find(
      (plugin: ResolvedPlugin) => plugin.qualifiedId === body.qualifiedId,
    )
    if (!resolved) return context.json({ status: 'error', error: 'plugin not found' }, 404)
    try {
      const outcome = await installPlugin(deps, resolved, {
        profile: body.profile ?? config.defaultProfile,
        allowBuild: body.allowBuild === true,
      })
      return context.json(outcome)
    } catch (error) {
      return context.json({ status: 'error', error: String(error) }, 200)
    }
  })

  app.post('/api/local/uninstall', async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as { id?: string; profile?: string }
    const outcome = await uninstallPlugin(deps, body.id ?? '', body.profile ?? config.defaultProfile)
    return context.json(outcome)
  })

  app.post('/api/local/enable', async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as {
      id?: string
      profile?: string
      configYaml?: string
    }
    const outcome = await enablePlugin(
      deps,
      body.id ?? '',
      body.profile ?? config.defaultProfile,
      body.configYaml,
    )
    return context.json(outcome)
  })

  app.post('/api/local/disable', async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as { id?: string; profile?: string }
    const outcome = await disablePlugin(deps, body.id ?? '', body.profile ?? config.defaultProfile)
    return context.json(outcome)
  })

  const root = webRoot()
  if (root) {
    // '/' must serve the LOCAL console entry — the web dist also contains the
    // server market SPA (index.html), and serveStatic's default directory
    // index would load that instead, leaving a blank page calling /api/v1.
    const localEntry = serveStatic({ root, path: '/local.html' })
    // serveStatic's middleware signature is wider than Hono's Handler type;
    // assert the wrapper to keep route registration type-clean.
    const serveLocal = ((
      context: Parameters<typeof localEntry>[0],
      next: Parameters<typeof localEntry>[1],
    ) => localEntry(context, next)) as unknown as Handler
    app.get('/', serveLocal)
    app.use('*', serveStatic({ root }))
    app.get('*', async (context, next) => {
      // Unknown API paths must answer JSON 404, never the SPA shell.
      if (context.req.path.startsWith('/api') || context.req.path === '/health') {
        context.status(404)
        return context.json({ error: 'not found' })
      }
      return serveLocal(context, next) as unknown as Response
    })
  } else {
    app.get('*', (context) =>
      context.text('web assets missing — run pnpm build in packages/web first', 500),
    )
  }
  return app
}

function openBrowser(url: string): void {
  const platform = process.platform
  const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url]
  try {
    spawn(command, args, { stdio: 'ignore', detached: true }).unref()
  } catch {
    // Browser opening is a convenience; the URL is printed regardless.
  }
}

export async function runLocalConsole(env: NodeJS.ProcessEnv): Promise<void> {
  const runner = new NodeRunner()
  const app = createLocalApp(runner, env)
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, (info) => {
    const url = `http://127.0.0.1:${info.port}`
    console.log(`dshm 本地控制台: ${url}`)
    console.log('浏览/安装/卸载全部 marketplace · Ctrl+C 退出（不常驻后台）')
    openBrowser(url)
  })
  process.on('SIGINT', () => {
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 500).unref()
  })
}
