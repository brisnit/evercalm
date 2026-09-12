import { appDb } from './client'
import type { Db } from './types'

/**
 * UNSCOPED DATABASE ACCESS - RESTRICTED.
 *
 * A handle with no tenant context. Sanctioned for GLOBAL IDENTITY TABLES ONLY
 * (sign-in, session lookup, verification), and for the one SECURITY DEFINER
 * membership function that has to run before a tenant context exists.
 *
 * Restricted by eslint to src/server/auth/** and src/server/db/**. Business
 * modules use withTenant() so that every query they make is constrained by
 * RLS. Pointing this at a tenant table returns nothing anyway - the policies
 * fail closed with no app.organization_id set - but the boundary exists so
 * nobody has to rely on that.
 */
export async function withGlobal<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  return fn(appDb())
}

/** For libraries needing a Db instance rather than a callback (Better Auth). */
export function globalDb(): Db {
  return appDb()
}
