/**
 * Refresh the development data.
 *
 * Truncates every application table and re-runs the seed, WITHOUT touching the
 * cluster or re-running migrations. Only ever the browser-test database
 * (evercalm_e2e, carrying the e2e marker) - see server/db/e2e-guard.ts. Browser tests mutate real state - marking
 * onboarding steps done, accepting invitations - so running them repeatedly
 * against an accumulating database makes them non-deterministic. This gives
 * each browser run the same starting point.
 *
 * Runs as the migration role, which owns the tables.
 *
 * Usage: npm run db:refresh   (MIGRATION_DATABASE_URL must be evercalm_e2e)
 */
import { config } from 'dotenv'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from '../src/server/db/full-schema'
import { seedAll } from '../src/server/db/seed'
import { assertDevelopmentDatabase } from '../src/lib/dev-only'
import { assertE2eDatabase } from '../src/server/db/e2e-guard'

config({ path: '.env.local', quiet: true })
config({ quiet: true })

const url = process.env.MIGRATION_DATABASE_URL
if (!url) {
  console.error('MIGRATION_DATABASE_URL is not set. See docs/database-setup.md.')
  process.exit(1)
}

// This truncates every table, so it runs nowhere but the browser suite's own
// local database: loopback host, the expected name, and the e2e marker on the
// database itself. A development, stakeholder-demo or production database is
// refused by name and again by marker.
assertDevelopmentDatabase('truncate and reseed the database', url)
await assertE2eDatabase('truncate and reseed the database', url)

const pool = new pg.Pool({ connectionString: url, max: 2 })

try {
  // Discover the tables rather than listing them, so a new table cannot be
  // forgotten here and leave stale rows behind.
  const { rows } = await pool.query<{ tablename: string }>(
    `select tablename from pg_tables
      where schemaname = 'public' and tablename <> 'evercalm_migrations'`,
  )
  const tables = rows.map((r) => `"${r.tablename}"`).join(', ')
  if (tables.length > 0) {
    await pool.query(`truncate table ${tables} restart identity cascade`)
  }

  const summary = await seedAll(drizzle(pool, { schema }))
  const created = summary.organizations.filter((o) => o.created)
  console.log(
    `Refreshed. Seeded ${created.length} organizations: ${created.map((o) => o.name).join(', ')}`,
  )
} finally {
  await pool.end()
}
