import { createPool, type PoolConnection, type Pool } from 'mysql2/promise'
import type { Dialect, QueryApi, SqlDriver } from './driver-types.js'

const DDL = [
  `CREATE TABLE IF NOT EXISTS plugins (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    author VARCHAR(255),
    homepage VARCHAR(512),
    license VARCHAR(64),
    verified TINYINT NOT NULL DEFAULT 0,
    source_type VARCHAR(32) NOT NULL,
    source_json TEXT NOT NULL,
    tags_json TEXT NOT NULL,
    images_json TEXT,
    updated_at VARCHAR(40) NOT NULL,
    INDEX idx_plugins_name (name),
    INDEX idx_plugins_source_type (source_type),
    INDEX idx_plugins_updated_at (updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS categories (
    id VARCHAR(255) PRIMARY KEY,
    name_zh VARCHAR(255),
    name_en VARCHAR(255),
    parent VARCHAR(255),
    description TEXT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS plugin_categories (
    plugin_id VARCHAR(255) NOT NULL,
    category_id VARCHAR(255) NOT NULL,
    PRIMARY KEY (plugin_id, category_id),
    INDEX idx_pc_category (category_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS api_tokens (
    token_hash CHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    admin TINYINT NOT NULL DEFAULT 0,
    created_at VARCHAR(40) NOT NULL,
    last_used_at VARCHAR(40)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS audit_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    at VARCHAR(40) NOT NULL,
    actor VARCHAR(255) NOT NULL,
    action VARCHAR(64) NOT NULL,
    target VARCHAR(255) NOT NULL,
    detail TEXT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS download_events (
    id INT AUTO_INCREMENT PRIMARY KEY,
    at VARCHAR(40) NOT NULL,
    plugin_id VARCHAR(255) NOT NULL,
    client VARCHAR(16) NOT NULL,
    source_type VARCHAR(16) NOT NULL,
    version VARCHAR(64),
    INDEX idx_de_plugin (plugin_id, at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS meta (
    \`key\` VARCHAR(255) PRIMARY KEY,
    value TEXT NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
]

const dialect: Dialect = {
  ddl: DDL,
  upsertPluginSql: `INSERT INTO plugins(id, name, description, author, homepage, license, verified, source_type, source_json, tags_json, images_json, updated_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      name = VALUES(name), description = VALUES(description), author = VALUES(author),
      homepage = VALUES(homepage), license = VALUES(license), verified = VALUES(verified),
      source_type = VALUES(source_type), source_json = VALUES(source_json),
      tags_json = VALUES(tags_json), images_json = VALUES(images_json),
      updated_at = VALUES(updated_at)`,
  upsertCategorySql: `INSERT INTO categories(id, name_zh, name_en, parent, description) VALUES(?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      name_zh = VALUES(name_zh), name_en = VALUES(name_en),
      parent = VALUES(parent), description = VALUES(description)`,
  upsertMetaSql: `INSERT INTO meta(\`key\`, value) VALUES(?, ?)
    ON DUPLICATE KEY UPDATE value = VALUES(value)`,
}

/** MySQL/MariaDB backend over a mysql2 pool. */
export class MysqlDriver implements SqlDriver {
  readonly kind = 'mysql' as const
  readonly dialect = dialect
  private readonly pool: Pool

  constructor(uri: string) {
    this.pool = createPool({ uri, connectionLimit: 5, multipleStatements: false })
  }

  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const [rows] = await this.pool.query(sql, params)
    return rows as T[]
  }

  async get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const [rows] = await this.pool.query(sql, params)
    return (rows as T[])[0]
  }

  async run(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
    const [result] = await this.pool.query(sql, params)
    const header = result as { affectedRows?: number }
    return { changes: header.affectedRows ?? 0 }
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql)
  }

  async transaction<T>(fn: (tx: QueryApi) => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection()
    try {
      await connection.beginTransaction()
      const result = await fn(boundTo(connection))
      await connection.commit()
      return result
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

function boundTo(connection: PoolConnection): QueryApi {
  return {
    all: async <T>(sql: string, params: unknown[] = []) => {
      const [rows] = await connection.query(sql, params)
      return rows as T[]
    },
    get: async <T>(sql: string, params: unknown[] = []) => {
      const [rows] = await connection.query(sql, params)
      return (rows as T[])[0]
    },
    run: async (sql: string, params: unknown[] = []) => {
      const [result] = await connection.query(sql, params)
      const header = result as { affectedRows?: number }
      return { changes: header.affectedRows ?? 0 }
    },
  }
}
