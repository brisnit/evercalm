import { afterAll, describe, expect, it } from 'vitest'
import { newId } from '@/lib/ids'
import { APP_ROLE, MIGRATOR_ROLE } from '../helpers/postgres'
import {
  appClient,
  closeTestPools,
  migrationClient,
  organizationIdBySlug,
  rawAsApp,
} from '../helpers/tenant'

afterAll(async () => {
  await closeTestPools()
})

describe('database role privileges', () => {
  it('runs the application as a role that CANNOT bypass RLS', async () => {
    const pool = await appClient()
    const { rows } = await pool.query<{
      role: string
      rolsuper: boolean
      rolbypassrls: boolean
      rolcreatedb: boolean
      rolcreaterole: boolean
    }>(
      `select current_user as role, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
         from pg_roles where rolname = current_user`,
    )
    const attrs = rows[0]
    expect(attrs?.role).toBe(APP_ROLE)
    expect(attrs?.rolsuper, 'runtime role must not be a superuser').toBe(false)
    expect(attrs?.rolbypassrls, 'runtime role must not bypass RLS').toBe(false)
    expect(attrs?.rolcreatedb).toBe(false)
    expect(attrs?.rolcreaterole).toBe(false)
  })

  it('uses a DIFFERENT role for migrations than for serving requests', async () => {
    const migration = await migrationClient()
    const { rows } = await migration.query<{ role: string }>('select current_user as role')
    expect(rows[0]?.role).toBe(MIGRATOR_ROLE)
    expect(rows[0]?.role).not.toBe(APP_ROLE)
  })

  it('grants the migration role no RLS bypass either - its exemption is table ownership', async () => {
    const pool = await migrationClient()
    const { rows } = await pool.query<{
      rolsuper: boolean
      rolbypassrls: boolean
      rolcreatedb: boolean
      rolcreaterole: boolean
    }>(
      `select rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
         from pg_roles where rolname = current_user`,
    )
    expect(rows[0]?.rolsuper, 'migration role must not be a superuser').toBe(false)
    expect(rows[0]?.rolbypassrls, 'migration role must not bypass RLS').toBe(false)
    // No migration or seed operation creates a database - the bootstrap
    // superuser does that and hands ownership over - so CREATEDB would be
    // privilege the migrator never exercises.
    expect(rows[0]?.rolcreatedb, 'migration role must not be able to create databases').toBe(false)
    expect(rows[0]?.rolcreaterole, 'migration role must not be able to create roles').toBe(false)
  })

  it('cannot create a database as the migration role', async () => {
    const pool = await migrationClient()
    await expect(pool.query('create database should_not_exist')).rejects.toThrow(
      /permission denied to create database/i,
    )
  })

  it('cannot create a role as the migration role', async () => {
    const pool = await migrationClient()
    await expect(pool.query("create role should_not_exist login password 'x'")).rejects.toThrow(
      /permission denied/i,
    )
  })

  it('does not let the runtime role create tables in the public schema', async () => {
    await expect(rawAsApp(null, 'create table should_not_exist (id int)')).rejects.toThrow(
      /permission denied/i,
    )
  })
})

describe('audit_events is append-only for the runtime role', () => {
  it('allows INSERT and SELECT', async () => {
    const harborId = await organizationIdBySlug('harbor-vine')
    const id = newId()
    await rawAsApp(
      harborId,
      `insert into audit_events (id, organization_id, action, summary, actor_type)
       values ($1, $2, 'location.updated', 'Append-only check', 'system')`,
      [id, harborId],
    )
    const read = await rawAsApp(harborId, 'select id from audit_events where id = $1', [id])
    expect(read.rows).toHaveLength(1)
  })

  it('REFUSES UPDATE - history cannot be rewritten', async () => {
    const harborId = await organizationIdBySlug('harbor-vine')
    await expect(
      rawAsApp(
        harborId,
        `update audit_events set summary = 'tampered' where organization_id = $1`,
        [harborId],
      ),
    ).rejects.toThrow(/permission denied/i)
  })

  it('REFUSES DELETE - history cannot be erased', async () => {
    const harborId = await organizationIdBySlug('harbor-vine')
    await expect(
      rawAsApp(harborId, 'delete from audit_events where organization_id = $1', [harborId]),
    ).rejects.toThrow(/permission denied/i)
  })

  it('hides platform-scoped events (organization_id IS NULL) from every tenant', async () => {
    const migration = await migrationClient()
    const platformId = newId()
    await migration.query(
      `insert into audit_events (id, organization_id, action, summary, actor_type)
       values ($1, null, 'auth.signed_in', 'Platform-scoped sign in', 'user')`,
      [platformId],
    )

    for (const slug of ['harbor-vine', 'lumen-salon']) {
      const orgId = await organizationIdBySlug(slug)
      const result = await rawAsApp(orgId, 'select id from audit_events where id = $1', [
        platformId,
      ])
      expect(result.rows, `${slug} could see a platform-scoped audit event`).toHaveLength(0)
    }

    // It does exist - the tenants simply cannot see it.
    const exists = await migration.query('select id from audit_events where id = $1', [platformId])
    expect(exists.rows).toHaveLength(1)
  })
})
