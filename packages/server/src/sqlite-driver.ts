import { createRequire } from 'node:module'
import type { Dialect, QueryApi, SqlDriver, SqlValue } from './driver-types.js'

// Bundlers rewrite static `node:sqlite` imports into a bare `sqlite` package
// import (which does not exist); resolving through createRequire keeps the
// builtin address intact in both dev and packed output.
type SqliteModule = typeof import('node:sqlite')
const sqlite = createRequire(import.meta.url)('node:sqlite') as SqliteModule
type DatabaseSyncInstance = InstanceType<SqliteModule['DatabaseSync']>

const DDL = [
  `CREATE TABLE IF NOT EXISTS plugins (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    author TEXT,
    homepage TEXT,
    license TEXT,
    verified INTEGER NOT NULL DEFAULT 0,
    source_type TEXT NOT NULL,
    source_json TEXT NOT NULL,
    tags_json TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_plugins_name ON plugins(name)',
  'CREATE INDEX IF NOT EXISTS idx_plugins_source_type ON plugins(source_type)',
  'CREATE INDEX IF NOT EXISTS idx_plugins_updated_at ON plugins(updated_at)',
  `CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name_zh TEXT,
    name_en TEXT,
    parent TEXT,
    description TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS plugin_categories (
    plugin_id TEXT NOT NULL,
    category_id TEXT NOT NULL,
    PRIMARY KEY (plugin_id, category_id)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_pc_category ON plugin_categories(category_id)',
  `CREATE TABLE IF NOT EXISTS api_tokens (
    token_hash TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    last_used_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    detail TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
]

const dialect: Dialect = {
  ddl: DDL,
  upsertPluginSql: `INSERT INTO plugins(id, name, description, author, homepage, license, verified, source_type, source_json, tags_json, updated_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, description = excluded.description, author = excluded.author,
      homepage = excluded.homepage, license = excluded.license, verified = excluded.verified,
      source_type = excluded.source_type, source_json = excluded.source_json,
      tags_json = excluded.tags_json, updated_at = excluded.updated_at`,
  upsertCategorySql: `INSERT INTO categories(id, name_zh, name_en, parent, description) VALUES(?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name_zh = excluded.name_zh, name_en = excluded.name_en,
      parent = excluded.parent, description = excluded.description`,
  upsertMetaSql: `INSERT INTO meta(key, value) VALUES(?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
}

/** SQLite backend over the Node built-in driver; sync calls wrapped async. */
export class SqliteDriver implements SqlDriver {
  readonly dialect = dialect
  private readonly db: DatabaseSyncInstance

  constructor(path: string) {
    this.db = new sqlite.DatabaseSync(path)
    for (const statement of DDL) this.db.exec(statement)
  }

  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...(params as SqlValue[])) as T[]
  }

  async get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return this.db.prepare(sql).get(...(params as SqlValue[])) as T | undefined
  }

  async run(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
    const result = this.db.prepare(sql).run(...(params as SqlValue[]))
    return { changes: Number(result.changes) }
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql)
  }

  async transaction<T>(fn: (tx: QueryApi) => Promise<T>): Promise<T> {
    this.db.exec('BEGIN')
    try {
      const result = await fn(this.tx)
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  private readonly tx: QueryApi = {
    all: (sql, params = []) => this.all(sql, params),
    get: (sql, params = []) => this.get(sql, params),
    run: (sql, params = []) => this.run(sql, params),
  }

  async close(): Promise<void> {
    this.db.close()
  }
}
