import { readFileSync } from 'node:fs'
import { serve } from '@hono/node-server'
import { Command } from 'commander'
import { openDatabase } from './driver.js'
import { RegistryRepo } from './repo.js'
import { AuditLog, TokenStore } from './tokens.js'
import { createApp } from './app.js'
import { parseRegistry } from '@dshm/core'

const program = new Command()

program
  .name('dshm-server')
  .description('SQLite/MySQL-backed plugin registry server for dshm')
  .option('--db <location>', 'sqlite file path or mysql:// URL (env DSHM_DB_URL)', '')

function dbLocation(explicit: string | undefined, command: Command): string {
  return explicit || command.opts()['db'] || process.env['DSHM_DB_URL'] || 'dshm-registry.db'
}

program
  .command('serve')
  .description('run the HTTP registry server')
  .option('--port <n>', 'listen port (env DSHM_PORT)', '8790')
  .option('--name <name>', 'registry name in exports (env DSHM_REGISTRY_NAME)', 'server')
  .action(async (options: { port: string; name: string }) => {
    const location = dbLocation(undefined, program)
    const driver = await openDatabase(location)
    const repo = new RegistryRepo(driver)
    const tokens = new TokenStore(driver)
    const audit = new AuditLog(driver)
    const bootstrap = process.env['DSHM_ADMIN_TOKEN']
    if (bootstrap && (await tokens.bootstrapAdminToken(bootstrap))) {
      console.log('seeded admin token from DSHM_ADMIN_TOKEN')
    }
    const app = createApp({ repo, driver, tokens, audit, registryName: options.name })
    const port = Number(options.port)
    serve({ fetch: app.fetch, port }, (info) => {
      console.log(
        `dshm-server listening on http://127.0.0.1:${info.port} (db: ${maskLocation(location)})`,
      )
      repo.countPlugins().then((count) => console.log(`  registry size: ${count} plugins`))
    })
  })

program
  .command('import')
  .description('load a registry.yaml file into the database')
  .argument('<file>', 'path to registry.yaml')
  .option('--mode <mode>', 'replace (default) or merge', 'replace')
  .action(async (file: string, options: { mode: string }) => {
    const driver = await openDatabase(dbLocation(undefined, program))
    const repo = new RegistryRepo(driver)
    const parsed = parseRegistry(
      (await import('yaml')).parse(readFileSync(file, 'utf8')) as Record<string, unknown>,
    )
    if (!parsed.ok) throw new Error(`invalid registry document: ${parsed.error}`)
    const mode = options.mode === 'merge' ? 'merge' : 'replace'
    const summary = await repo.importRegistry(parsed.data, mode)
    console.log(`imported ${summary.plugins} plugins (${mode})`)
    await driver.close()
  })

const token = program.command('token').description('manage API tokens')

token
  .command('create')
  .description('mint a token; the raw value is shown exactly once')
  .argument('<name>', 'token name')
  .option('--admin', 'grant admin rights')
  .action(async (name: string, options: { admin?: boolean }) => {
    const driver = await openDatabase(dbLocation(undefined, program))
    const raw = await new TokenStore(driver).create(name, options.admin === true)
    console.log(raw)
    await driver.close()
  })

token.command('list').action(async () => {
  const driver = await openDatabase(dbLocation(undefined, program))
  for (const row of await new TokenStore(driver).list()) {
    console.log(
      `${row.admin ? 'admin' : 'read '}  ${row.name}  created=${row.created_at} last_used=${row.last_used_at ?? 'never'}`,
    )
  }
  await driver.close()
})

token
  .command('revoke')
  .argument('<name>', 'token name')
  .action(async (name: string) => {
    const driver = await openDatabase(dbLocation(undefined, program))
    console.log((await new TokenStore(driver).revoke(name)) ? 'revoked' : 'not found')
    await driver.close()
  })

function maskLocation(location: string): string {
  return location.replace(/\/\/[^@]*@/, '//***@')
}

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
