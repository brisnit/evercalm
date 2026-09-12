import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { newId } from '@/lib/ids'
import { tenantTables } from '@/server/db/tenant-tables'
import {
  appClient,
  appDrizzle,
  closeTestPools,
  organizationIdBySlug,
  rawAsApp,
} from '../helpers/tenant'

/**
 * CROSS-TENANT ISOLATION, proved against the two seeded organizations:
 * Harbor & Vine (restaurant) and Lumen Salon & Spa (salon).
 *
 * Every assertion here runs as the APPLICATION role, which is NOSUPERUSER and
 * NOBYPASSRLS - the same role that serves requests.
 */

let harborId: string
let lumenId: string

beforeAll(async () => {
  harborId = await organizationIdBySlug('harbor-vine')
  lumenId = await organizationIdBySlug('lumen-salon')
  expect(harborId).not.toBe(lumenId)
})

afterAll(async () => {
  await closeTestPools()
})

describe('a tenant sees only its own rows', () => {
  it('shows each organization exactly one organization row - its own', async () => {
    const harbor = await rawAsApp(harborId, 'select id, slug from organizations')
    expect(harbor.rows).toHaveLength(1)
    expect((harbor.rows[0] as { slug: string }).slug).toBe('harbor-vine')

    const lumen = await rawAsApp(lumenId, 'select id, slug from organizations')
    expect(lumen.rows).toHaveLength(1)
    expect((lumen.rows[0] as { slug: string }).slug).toBe('lumen-salon')
  })

  it('returns ZERO rows for every tenant table when reading as the other tenant', async () => {
    for (const table of tenantTables()) {
      const column = table.tenantColumn
      const result = await rawAsApp(
        lumenId,
        `select count(*)::int as count from "${table.name}" where "${column}" = $1`,
        [harborId],
      )
      expect(
        (result.rows[0] as { count: number }).count,
        `${table.name} leaked Harbor & Vine rows to the salon tenant`,
      ).toBe(0)
    }
  })

  it('cannot see the other tenant even when naming its primary key directly', async () => {
    const employments = await rawAsApp(
      harborId,
      'select id from employments where organization_id = $1',
      [harborId],
    )
    const harborEmploymentId = (employments.rows[0] as { id: string }).id
    expect(harborEmploymentId).toBeTruthy()

    // An insecure direct object reference: the salon asks for a known-good
    // Harbor employment id. It must come back empty, not forbidden.
    const probe = await rawAsApp(lumenId, 'select id from employments where id = $1', [
      harborEmploymentId,
    ])
    expect(probe.rows).toHaveLength(0)
  })

  it('finds real data on both sides, so the zeroes above mean isolation not emptiness', async () => {
    const harborLocations = await rawAsApp(harborId, 'select name from locations order by name')
    const lumenLocations = await rawAsApp(lumenId, 'select name from locations order by name')
    expect(harborLocations.rows.map((r) => (r as { name: string }).name)).toEqual([
      'Downtown',
      'Riverside',
    ])
    expect(lumenLocations.rows.map((r) => (r as { name: string }).name)).toEqual([
      'Boise Bench',
      'Pearl District',
    ])
  })
})

describe('a tenant cannot write into another tenant', () => {
  it('refuses an INSERT carrying another organization id', async () => {
    await expect(
      rawAsApp(
        lumenId,
        `insert into locations (id, organization_id, name, timezone)
         values ($1, $2, 'Smuggled', 'America/Los_Angeles')`,
        [newId(), harborId],
      ),
    ).rejects.toThrow(/row-level security/i)
  })

  it('refuses an UPDATE aimed at another tenant, silently affecting nothing', async () => {
    const result = await rawAsApp(
      lumenId,
      `update locations set name = 'Renamed' where organization_id = $1`,
      [harborId],
    )
    expect(result.rowCount).toBe(0)

    const check = await rawAsApp(harborId, 'select name from locations order by name')
    expect(check.rows.map((r) => (r as { name: string }).name)).toEqual(['Downtown', 'Riverside'])
  })

  it('refuses a DELETE aimed at another tenant', async () => {
    const result = await rawAsApp(lumenId, 'delete from employments where organization_id = $1', [
      harborId,
    ])
    expect(result.rowCount).toBe(0)
  })
})

describe('composite foreign keys make cross-tenant references structurally impossible', () => {
  it('rejects a role grant pointing at another tenant location, even as the schema owner', async () => {
    // Run as the MIGRATION role, which bypasses RLS as table owner. The
    // composite foreign key must still refuse - this is the layer that holds
    // when RLS is not in play.
    const { migrationClient } = await import('../helpers/tenant')
    const pool = await migrationClient()

    const harborLocation = await pool.query<{ id: string }>(
      'select id from locations where organization_id = $1 limit 1',
      [harborId],
    )
    const lumenEmployment = await pool.query<{ id: string }>(
      'select id from employments where organization_id = $1 limit 1',
      [lumenId],
    )
    const lumenRole = await pool.query<{ id: string }>(
      'select id from roles where organization_id = $1 limit 1',
      [lumenId],
    )

    await expect(
      pool.query(
        `insert into role_grants (id, organization_id, employment_id, role_id, scope, location_id)
         values ($1, $2, $3, $4, 'location', $5)`,
        [
          newId(),
          lumenId,
          lumenEmployment.rows[0]?.id,
          lumenRole.rows[0]?.id,
          harborLocation.rows[0]?.id, // another tenant's location
        ],
      ),
    ).rejects.toThrow(/role_grants_location_tenant_fk|foreign key/i)
  })
})

describe('transaction-scoped tenant context', () => {
  it('does not leak app.organization_id to the next user of a pooled connection', async () => {
    // The classic RLS + connection pooling failure. SET LOCAL must not survive
    // the transaction, or the next request on this connection inherits a
    // tenant it has no right to.
    const pool = await appClient()
    const client = await pool.connect()
    try {
      await client.query('begin')
      await client.query(`select set_config('app.organization_id', $1, true)`, [harborId])
      const inside = await client.query('select count(*)::int as count from organizations')
      expect((inside.rows[0] as { count: number }).count).toBe(1)
      await client.query('commit')

      // Same physical connection, no transaction: context must be gone.
      const setting = await client.query<{ value: string }>(
        `select current_setting('app.organization_id', true) as value`,
      )
      expect(setting.rows[0]?.value ?? '').toBe('')

      const after = await client.query('select count(*)::int as count from organizations')
      expect((after.rows[0] as { count: number }).count).toBe(0)
    } finally {
      client.release()
    }
  })

  it('scopes context per transaction when tenants interleave on one pool', async () => {
    const db = await appDrizzle()
    const [fromHarbor, fromLumen] = await Promise.all([
      db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.organization_id', ${harborId}, true)`)
        return tx.execute<{ slug: string }>(sql`select slug from organizations`)
      }),
      db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.organization_id', ${lumenId}, true)`)
        return tx.execute<{ slug: string }>(sql`select slug from organizations`)
      }),
    ])
    expect(fromHarbor.rows.map((r) => r.slug)).toEqual(['harbor-vine'])
    expect(fromLumen.rows.map((r) => r.slug)).toEqual(['lumen-salon'])
  })
})
