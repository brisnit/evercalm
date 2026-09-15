import * as schema from './full-schema'
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core'

/**
 * TENANT TABLE REGISTRY - derived, never hand-maintained.
 *
 * A table is tenant-owned if it has an `organization_id` column. The RLS
 * coverage test reflects over this list, so adding a new tenant table without
 * an RLS policy fails CI automatically. There is no list to forget to update.
 */

export interface TenantTableInfo {
  readonly name: string
  readonly tenantColumn: string
}

function isPgTable(value: unknown): value is PgTable {
  return typeof value === 'object' && value !== null && Symbol.for('drizzle:Name') in value
}

export function allTables(): { name: string; columns: string[] }[] {
  const out: { name: string; columns: string[] }[] = []
  for (const value of Object.values(schema)) {
    if (!isPgTable(value)) continue
    const config = getTableConfig(value)
    out.push({ name: config.name, columns: config.columns.map((c) => c.name) })
  }
  return out
}

/**
 * The tenant root table. It is keyed by `id` rather than `organization_id`,
 * so a naive "has an organization_id column" filter would miss the one table
 * that most needs protection - a tenant being able to list every customer.
 */
export const TENANT_ROOT_TABLE = 'organizations'

/**
 * Every tenant-owned table and the column its RLS policy keys on.
 * Derived from the schema, so a new tenant table is picked up automatically.
 */
export function tenantTables(): TenantTableInfo[] {
  const out: TenantTableInfo[] = []
  for (const t of allTables()) {
    if (t.name === TENANT_ROOT_TABLE) {
      out.push({ name: t.name, tenantColumn: 'id' })
    } else if (t.columns.includes('organization_id')) {
      out.push({ name: t.name, tenantColumn: 'organization_id' })
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Tables deliberately exempt from tenant RLS, each with a stated reason.
 * Anything not in this list and without an organization_id is a design error
 * the coverage test will surface.
 */
export const RLS_EXEMPT_TABLES: Record<string, string> = {
  user: 'Global identity. A person may work for multiple customers.',
  session: 'Authentication state, resolved before any organization context exists.',
  account: 'Credential storage bound to a global user.',
  verification: 'Email verification and reset tokens, used pre-authentication.',
  platform_staff:
    'EverCalm staff, not customer data. Read-only to the runtime role; used only by the authentication adapter.',
  support_internal_notes:
    'EverCalm-internal case notes. The runtime role holds no privileges on it; reached only through staff functions.',
  worker_runs:
    'Background worker tick records. Customers see only their own error count, through a function keyed on the tenant setting.',
  evercalm_migrations:
    'Migration bookkeeping owned by the migration role; not part of the Drizzle schema.',
}
