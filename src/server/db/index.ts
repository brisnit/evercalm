import { sql } from 'drizzle-orm'
import { appDb, appPool } from './client'
import { ConfigurationError } from '@/lib/errors'
import type { Db, Tx } from './types'

export type { Db, Tx, FullSchema } from './types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * TENANT-SCOPED DATABASE ACCESS.
 *
 * Every tenant query runs inside withTenant(). It opens a transaction, sets
 * app.organization_id with SET LOCAL semantics, and runs the callback. The
 * setting is scoped to the transaction, so it cannot leak to the next request
 * that borrows the same pooled connection - there is an integration test that
 * proves exactly this.
 *
 * The runtime role is NOSUPERUSER and NOBYPASSRLS, so even a SQL injection
 * that reached this connection could not read another tenant's rows.
 *
 * This is the ONLY database entry point available to business modules.
 * Unscoped access lives in ./global and is restricted to the authentication
 * adapter - see docs/architecture.md.
 */
export async function withTenant<T>(
  organizationId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(organizationId)) {
    throw new ConfigurationError('withTenant requires a valid organization id')
  }
  return appDb().transaction(async (tx) => {
    // `true` = local to this transaction.
    await tx.execute(sql`select set_config('app.organization_id', ${organizationId}, true)`)
    return fn(tx)
  })
}

export interface RuntimeRoleAttributes {
  role: string
  isSuperuser: boolean
  canBypassRls: boolean
  canCreateDb: boolean
  canCreateRole: boolean
}

/** Read the runtime role's actual privileges from the server. */
export async function runtimeRoleAttributes(): Promise<RuntimeRoleAttributes> {
  const result = await appPool().query<{
    role: string
    rolsuper: boolean
    rolbypassrls: boolean
    rolcreatedb: boolean
    rolcreaterole: boolean
  }>(
    `select current_user as role, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
       from pg_roles where rolname = current_user`,
  )
  const row = result.rows[0]
  if (!row) throw new ConfigurationError('Could not read the current database role')
  return {
    role: row.role,
    isSuperuser: row.rolsuper,
    canBypassRls: row.rolbypassrls,
    canCreateDb: row.rolcreatedb,
    canCreateRole: row.rolcreaterole,
  }
}

/**
 * Boot guard. A runtime role that can bypass RLS silently disables the
 * primary isolation layer, so the application refuses to serve traffic.
 */
export async function assertRuntimeRoleIsSafe(): Promise<RuntimeRoleAttributes> {
  const attrs = await runtimeRoleAttributes()
  if (attrs.isSuperuser || attrs.canBypassRls) {
    throw new ConfigurationError(
      `Database role "${attrs.role}" can bypass Row-Level Security ` +
        `(superuser=${attrs.isSuperuser}, bypassrls=${attrs.canBypassRls}). ` +
        `DATABASE_URL must point at a NOSUPERUSER, NOBYPASSRLS role. Refusing to start.`,
    )
  }
  return attrs
}

export type { Db as DbHandle }
export { appPool, closePools } from './client'
export { organizationsWithDueWork } from './due-work'
