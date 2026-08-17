import { createHash, randomBytes } from 'node:crypto'
import type { AuditRow, SqlDriver, TokenRow } from './driver-types.js'

/**
 * API tokens are stored as sha256 hashes; the raw token is shown exactly once
 * at creation. Bearer auth resolves a hash to its row.
 */

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export function mintToken(): string {
  return randomBytes(24).toString('base64url')
}

export interface TokenIdentity {
  name: string
  admin: boolean
}

export class TokenStore {
  constructor(private readonly driver: SqlDriver) {}

  async create(name: string, admin: boolean): Promise<string> {
    const raw = mintToken()
    await this.driver.run(
      'INSERT INTO api_tokens(token_hash, name, admin, created_at) VALUES(?, ?, ?, ?)',
      [hashToken(raw), name, admin ? 1 : 0, new Date().toISOString()],
    )
    return raw
  }

  async list(): Promise<Array<Omit<TokenRow, 'admin'> & { admin: boolean }>> {
    const rows = await this.driver.all<TokenRow>('SELECT * FROM api_tokens ORDER BY created_at')
    return rows.map((row) => ({ ...row, admin: row.admin === 1 }))
  }

  async revoke(name: string): Promise<boolean> {
    const result = await this.driver.run('DELETE FROM api_tokens WHERE name = ?', [name])
    return result.changes > 0
  }

  /** Resolve a bearer token; records last use on success. */
  async verify(raw: string): Promise<TokenIdentity | undefined> {
    const row = await this.driver.get<TokenRow>('SELECT * FROM api_tokens WHERE token_hash = ?', [
      hashToken(raw),
    ])
    if (!row) return undefined
    await this.driver.run('UPDATE api_tokens SET last_used_at = ? WHERE token_hash = ?', [
      new Date().toISOString(),
      row.token_hash,
    ])
    return { name: row.name, admin: row.admin === 1 }
  }

  /** Seed an initial admin token from the environment when none exists. */
  async bootstrapAdminToken(raw: string): Promise<boolean> {
    const existing = await this.driver.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM api_tokens WHERE admin = 1',
    )
    if ((existing?.n ?? 0) > 0) return false
    await this.driver.run(
      'INSERT INTO api_tokens(token_hash, name, admin, created_at) VALUES(?, ?, 1, ?)',
      [hashToken(raw), 'bootstrap-admin', new Date().toISOString()],
    )
    return true
  }
}

export class AuditLog {
  constructor(private readonly driver: SqlDriver) {}

  async record(actor: string, action: string, target: string, detail?: string): Promise<void> {
    await this.driver.run(
      'INSERT INTO audit_log(at, actor, action, target, detail) VALUES(?, ?, ?, ?, ?)',
      [new Date().toISOString(), actor, action, target, detail ?? null],
    )
  }

  async list(limit: number): Promise<AuditRow[]> {
    return this.driver.all<AuditRow>('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?', [limit])
  }
}
