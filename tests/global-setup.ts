import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { runMigrations } from '@/server/db/migrate'
import * as schema from '@/server/db/full-schema'
import { seedAll } from '@/server/db/seed'
import { startTestPostgres, stopTestPostgres } from './helpers/postgres'

/**
 * Boots one real PostgreSQL instance for the integration run, migrates it as
 * the privileged role, and seeds both tenants so cross-tenant tests have
 * genuine data on both sides.
 */
export async function setup(): Promise<void> {
  const info = await startTestPostgres()

  const result = await runMigrations(info.migrationUrl)
  if (result.applied.length === 0) {
    throw new Error('No migrations were applied to the test database')
  }

  const pool = new pg.Pool({ connectionString: info.migrationUrl, max: 2 })
  try {
    const summary = await seedAll(drizzle(pool, { schema }))
    const created = summary.organizations.filter((o) => o.created)
    if (created.length < 2) {
      throw new Error('Expected two seeded organizations for cross-tenant testing')
    }
  } finally {
    await pool.end()
  }
}

export async function teardown(): Promise<void> {
  await stopTestPostgres()
}
