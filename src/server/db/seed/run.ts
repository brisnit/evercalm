import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from '../full-schema'
import { seedAll, SEED_PASSWORD } from './index'

/**
 * CLI: npm run db:seed
 *
 * Connects with MIGRATION_DATABASE_URL. The runtime role cannot seed, because
 * RLS would (correctly) block it from writing rows for organizations it has
 * no context for.
 */
const isDirectRun =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])

if (isDirectRun) {
  const { config } = await import('dotenv')
  config({ path: '.env.local', quiet: true })
  config({ quiet: true })

  const url = process.env.MIGRATION_DATABASE_URL
  if (!url) {
    console.error('MIGRATION_DATABASE_URL is not set. See docs/database-setup.md.')
    process.exit(1)
  }

  const pool = new pg.Pool({
    connectionString: url,
    ssl: /\bsslmode=require\b/.test(url) ? { rejectUnauthorized: true } : undefined,
  })
  const db = drizzle(pool, { schema })

  try {
    const summary = await seedAll(db)
    for (const org of summary.organizations) {
      console.log(
        org.created
          ? `  + ${org.name} (${org.industry}): ${org.locations} locations, ${org.people} people, ${org.roles} roles, ${org.grants} grants`
          : `  = ${org.name} already seeded, skipped`,
      )
    }
    if (summary.organizations.some((o) => o.created)) {
      console.log(`\nDevelopment password for every seeded account: ${SEED_PASSWORD}`)
    }
  } finally {
    await pool.end()
  }
}
