import type { SqlDriver } from './driver-types.js'

export type {
  AuditRow,
  CategoryRow,
  Dialect,
  PluginRow,
  QueryApi,
  SqlDriver,
  SqlValue,
  TokenRow,
} from './driver-types.js'

/**
 * Open the backend selected by `location`: a mysql:// URL routes to the mysql2
 * driver, anything else is treated as a SQLite file path.
 */
export function isMysqlUrl(location: string): boolean {
  return /^(mysql2?|mariadb):/i.test(location)
}

export async function openDatabase(location: string): Promise<SqlDriver> {
  if (isMysqlUrl(location)) {
    const { MysqlDriver } = await import('./mysql-driver.js')
    return new MysqlDriver(location)
  }
  const { SqliteDriver } = await import('./sqlite-driver.js')
  return new SqliteDriver(location)
}
