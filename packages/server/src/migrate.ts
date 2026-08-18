import type { SqlDriver } from './driver-types.js'

/**
 * Idempotent schema migrations for databases created by older versions.
 * CREATE TABLE IF NOT EXISTS in the dialect DDL covers fresh installs and new
 * tables; additive columns need a capability check because MySQL 5.7 has no
 * ADD COLUMN IF NOT EXISTS.
 */
export async function applyMigrations(driver: SqlDriver): Promise<void> {
  await ensureColumn(driver, 'plugins', 'images_json', 'TEXT')
  await ensureColumn(driver, 'plugins', 'deps_json', 'TEXT')
}

async function ensureColumn(
  driver: SqlDriver,
  table: string,
  column: string,
  definition: string,
): Promise<void> {
  if (driver.kind === 'mysql') {
    const row = await driver.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    )
    if ((row?.n ?? 0) === 0) {
      await driver.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    }
    return
  }
  const columns = await driver.all<{ name: string }>(`PRAGMA table_info(${table})`)
  if (!columns.some((entry) => entry.name === column)) {
    await driver.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}
