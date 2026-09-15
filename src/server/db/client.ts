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

export interface PoolSettings {
  max: number
  idleTimeoutMillis: number
  allowExitOnIdle: boolean
}

/**
 * Connection pool sizing for the runtime pool.
 *
 * On Vercel each function instance holds its own pool, and many instances can
 * run at once against one database, so the default is small (3), idle
 * connections are released quickly, and an idle pool never keeps an instance
 * alive. DATABASE_POOL_MAX overrides the size. DATABASE_URL should be the
 * provider's pooled, transaction-mode endpoint (see docs/database-setup.md):
 * tenant context is SET LOCAL inside a transaction, which is safe with it.
 */
export function poolSettings(configuredMax: number | undefined, onVercel: boolean): PoolSettings {
  return {
    max: configuredMax ?? (onVercel ? 3 : 10),
    idleTimeoutMillis: onVercel ? 5_000 : 30_000,
    allowExitOnIdle: onVercel,
  }
}

function makePool(connectionString: string, settings: PoolSettings): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    max: settings.max,
    idleTimeoutMillis: settings.idleTimeoutMillis,
    allowExitOnIdle: settings.allowExitOnIdle,
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
  const env = getEnv()
  _appPool ??= makePool(
    env.DATABASE_URL,
    poolSettings(env.DATABASE_POOL_MAX, process.env.VERCEL === '1'),
  )
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
  _migrationPool ??= makePool(url, { max: 2, idleTimeoutMillis: 30_000, allowExitOnIdle: false })
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
    _appPool = makePool(opts.appUrl, { max: 5, idleTimeoutMillis: 30_000, allowExitOnIdle: false })
  }
  if (opts.migrationUrl) {
    _migrationPool = makePool(opts.migrationUrl, {
      max: 2,
      idleTimeoutMillis: 30_000,
      allowExitOnIdle: false,
    })
  }
}
