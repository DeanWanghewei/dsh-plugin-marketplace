/** Driver-agnostic query surface and row shapes, shared by both backends. */

export interface QueryApi {
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>
}

/**
 * Dialect-owned SQL: DDL executed once on open, plus the three upsert
 * statements whose conflict syntax differs between SQLite and MySQL. The
 * parameter order matches the repo's call sites exactly.
 */
export interface Dialect {
  ddl: string[]
  upsertPluginSql: string
  upsertCategorySql: string
  upsertMetaSql: string
}

export interface SqlDriver extends QueryApi {
  readonly kind: 'sqlite' | 'mysql'
  readonly dialect: Dialect
  exec(sql: string): Promise<void>
  transaction<T>(fn: (tx: QueryApi) => Promise<T>): Promise<T>
  close(): Promise<void>
}

/** node:sqlite accepts exactly these as bound parameter values. */
export type SqlValue = null | number | bigint | string | Uint8Array

export interface PluginRow {
  id: string
  name: string
  description: string
  author: string | null
  homepage: string | null
  license: string | null
  verified: number
  source_type: string
  source_json: string
  tags_json: string
  /** Nullable for rows written before the images migration. */
  images_json: string | null
  updated_at: string
}

export interface CategoryRow {
  id: string
  name_zh: string | null
  name_en: string | null
  parent: string | null
  description: string | null
}

export interface TokenRow {
  token_hash: string
  name: string
  admin: number
  created_at: string
  last_used_at: string | null
}

export interface AuditRow {
  id: number
  at: string
  actor: string
  action: string
  target: string
  detail: string | null
}
