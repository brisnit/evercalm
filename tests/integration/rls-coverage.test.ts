import { afterAll, describe, expect, it } from 'vitest'
import { RLS_EXEMPT_TABLES, allTables, tenantTables } from '@/server/db/tenant-tables'
import { closeTestPools, migrationClient, rawAsApp } from '../helpers/tenant'

/**
 * RLS COVERAGE - THE TEST THAT CANNOT BE FORGOTTEN.
 *
 * This suite reflects over the Drizzle schema at run time rather than reading
 * a hand-maintained list. Adding a tenant table without an RLS policy fails
 * CI automatically, because there is no list anyone could forget to update.
 */

afterAll(async () => {
  await closeTestPools()
})

describe('every tenant table is protected', () => {
  it('finds the tenant tables by reflection, including the tenant root', () => {
    const names = tenantTables().map((t) => t.name)
    expect(names).toContain('organizations') // keyed by id, not organization_id
    expect(names).toContain('locations')
    expect(names).toContain('employments')
    expect(names).toContain('role_grants')
    expect(names).toContain('audit_events')
    expect(names.length).toBeGreaterThanOrEqual(8)
  })

  it('has row-level security ENABLED on every tenant table', async () => {
    const pool = await migrationClient()
    const { rows } = await pool.query<{ tablename: string; rowsecurity: boolean }>(
      `select tablename, rowsecurity from pg_tables where schemaname = 'public'`,
    )
    const byName = new Map(rows.map((r) => [r.tablename, r.rowsecurity]))

    const unprotected = tenantTables()
      .filter((t) => byName.get(t.name) !== true)
      .map((t) => t.name)

    expect(
      unprotected,
      `These tenant tables have no RLS enabled. Add a policy in a migration:\n  ${unprotected.join('\n  ')}`,
    ).toEqual([])
  })

  it('has a tenant_isolation POLICY on every tenant table', async () => {
    const pool = await migrationClient()
    const { rows } = await pool.query<{ tablename: string; policyname: string }>(
      `select tablename, policyname from pg_policies where schemaname = 'public'`,
    )
    const policied = new Set(
      rows.filter((r) => r.policyname === 'tenant_isolation').map((r) => r.tablename),
    )

    const missing = tenantTables()
      .filter((t) => !policied.has(t.name))
      .map((t) => t.name)

    expect(
      missing,
      `These tenant tables have RLS enabled but no tenant_isolation policy:\n  ${missing.join('\n  ')}`,
    ).toEqual([])
  })

  it('accounts for every table as either tenant-owned or explicitly exempt', () => {
    const tenantNames = new Set(tenantTables().map((t) => t.name))
    const unaccounted = allTables()
      .map((t) => t.name)
      .filter((name) => !tenantNames.has(name) && !(name in RLS_EXEMPT_TABLES))

    expect(
      unaccounted,
      `These tables are neither tenant-owned nor listed in RLS_EXEMPT_TABLES with a reason:\n  ${unaccounted.join('\n  ')}`,
    ).toEqual([])
  })

  it('policies fail CLOSED when no tenant context is set', async () => {
    // No app.organization_id: current_setting returns '', nullif makes it
    // NULL, and NULL = anything is never true. Every tenant table must be
    // empty rather than fully readable.
    for (const table of tenantTables()) {
      const result = await rawAsApp(null, `select count(*)::int as count from "${table.name}"`)
      expect(
        (result.rows[0] as { count: number }).count,
        `${table.name} leaked rows with no tenant context`,
      ).toBe(0)
    }
  })
})
