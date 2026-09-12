import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { getEnv } from '@/lib/env'
import * as schema from './full-schema'

/**
 * RAW DATABASE CLIENTS - RESTRICTED.
 *
 * Importing this module outside src/server/db/ is an eslint error. Everything
 * else uses withTenant()/withGlobal() from '@/server/db', which guarantee
 * app.organization_id is set inside the transaction that runs the query.
 *
 * Two pools, two roles, deliberately:
 *   appPool       - runtime role. NOSUPERUSER, NOBYPASSRLS. Serves requests.
 *   migrationPool - privileged role. Owns DDL. Never serves a request.
 */

let _appPool: pg.Pool | undefined
let _migrationPool: pg.Pool | undefined

function makePool(connectionString: string, max: number): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Neon and most managed Postgres require TLS; local dev does not.
    ssl: /\bsslmode=require\b/.test(connectionString) ? { rejectUnauthorized: true } : undefined,
  })
  pool.on('error', (err) => {
    // Never let an idle-client error take the process down silently.
    console.error('[db] idle client error', err.message)
  })
  return pool
}

export function appPool(): pg.Pool {
  _appPool ??= makePool(getEnv().DATABASE_URL, 10)
  return _appPool
}

export function migrationPool(): pg.Pool {
  const env = getEnv()
  const url = env.MIGRATION_DATABASE_URL
  if (!url) {
    throw new Error(
      'MIGRATION_DATABASE_URL is not set. Migrations must run as the privileged migration role, never as the application runtime role.',
    )
  }
  _migrationPool ??= makePool(url, 2)
  return _migrationPool
}

export const appDb = () => drizzle(appPool(), { schema })
export const migrationDb = () => drizzle(migrationPool(), { schema })

export async function closePools(): Promise<void> {
  await Promise.all([_appPool?.end(), _migrationPool?.end()])
  _appPool = undefined
  _migrationPool = undefined
}

/** Test/CLI override so a throwaway database can be injected. */
export function overrideConnectionStrings(opts: { appUrl?: string; migrationUrl?: string }): void {
  if (opts.appUrl) {
    _appPool = makePool(opts.appUrl, 5)
  }
  if (opts.migrationUrl) {
    _migrationPool = makePool(opts.migrationUrl, 2)
  }
}
