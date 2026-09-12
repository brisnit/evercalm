import { drizzle } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import pg from 'pg'
import * as schema from '@/server/db/full-schema'
import { testDatabaseInfo } from './postgres'

/**
 * Test-side database handles.
 *
 * Deliberately does NOT reuse the application's pool helpers, so a bug in the
 * application's tenant scoping cannot hide itself from these tests by being
 * present on both sides.
 */

let appPool: pg.Pool | undefined
let migrationPool: pg.Pool | undefined

export async function appClient(): Promise<pg.Pool> {
  if (!appPool)
    appPool = new pg.Pool({ connectionString: (await testDatabaseInfo()).appUrl, max: 4 })
  return appPool
}

export async function migrationClient(): Promise<pg.Pool> {
  if (!migrationPool)
    migrationPool = new pg.Pool({
      connectionString: (await testDatabaseInfo()).migrationUrl,
      max: 2,
    })
  return migrationPool
}

export async function appDrizzle() {
  return drizzle(await appClient(), { schema })
}

export async function migrationDrizzle() {
  return drizzle(await migrationClient(), { schema })
}

export async function closeTestPools(): Promise<void> {
  await Promise.all([appPool?.end(), migrationPool?.end()])
  appPool = undefined
  migrationPool = undefined
}

/**
 * Run a callback as the APPLICATION role inside a tenant transaction - the
 * same shape as the production withTenant().
 */
export async function asTenant<T>(
  organizationId: string,
  fn: (
    tx: Parameters<Parameters<Awaited<ReturnType<typeof appDrizzle>>['transaction']>[0]>[0],
  ) => Promise<T>,
): Promise<T> {
  const db = await appDrizzle()
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.organization_id', ${organizationId}, true)`)
    return fn(tx)
  })
}

/** Raw SQL as the application role with an explicit (or absent) tenant context. */
export async function rawAsApp(
  organizationId: string | null,
  query: string,
  params: unknown[] = [],
): Promise<pg.QueryResult> {
  const pool = await appClient()
  const client = await pool.connect()
  try {
    await client.query('begin')
    if (organizationId !== null) {
      await client.query(`select set_config('app.organization_id', $1, true)`, [organizationId])
    }
    const result = await client.query(query, params)
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export async function organizationIdBySlug(slug: string): Promise<string> {
  const pool = await migrationClient()
  const result = await pool.query<{ id: string }>('select id from organizations where slug = $1', [
    slug,
  ])
  const id = result.rows[0]?.id
  if (!id) throw new Error(`Seeded organization "${slug}" not found`)
  return id
}
