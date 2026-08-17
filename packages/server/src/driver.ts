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
    const driver = new MysqlDriver(location)
    // The MySQL driver only creates the pool; apply the schema here so both
    // backends are guaranteed initialized by the time openDatabase returns
    // (the SQLite driver does this in its own constructor).
    for (const statement of driver.dialect.ddl) await driver.exec(statement)
    return driver
  }
  const { SqliteDriver } = await import('./sqlite-driver.js')
  return new SqliteDriver(location)
}
