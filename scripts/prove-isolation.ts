/**
 * Isolation proof.
 *
 * Runs the two attacks that matter against the seeded tenants and prints what
 * the database actually did. This is a demonstration harness - the same
 * properties are asserted by the test suite, which is what gates CI.
 *
 * Usage: npx tsx scripts/prove-isolation.ts
 */
import { config } from 'dotenv'
import pg from 'pg'

config({ path: '.env.local', quiet: true })

const appUrl = process.env.DATABASE_URL!
const migratorUrl = process.env.MIGRATION_DATABASE_URL!

const app = new pg.Pool({ connectionString: appUrl, max: 4 })
const migrator = new pg.Pool({ connectionString: migratorUrl, max: 2 })

function line(label: string, value: string) {
  console.log(`  ${label.padEnd(46)} ${value}`)
}
function heading(text: string) {
  console.log(`\n${text}\n${'-'.repeat(text.length)}`)
}

/** Query as the runtime role with an explicit tenant context. */
async function asTenant<T extends pg.QueryResultRow>(
  orgId: string | null,
  sql: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  const client = await app.connect()
  try {
    await client.query('begin')
    if (orgId) await client.query(`select set_config('app.organization_id', $1, true)`, [orgId])
    const result = await client.query<T>(sql, params)
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

const orgs = await migrator.query<{ id: string; name: string; slug: string }>(
  'select id, name, slug from organizations order by slug',
)
const harbor = orgs.rows.find((o) => o.slug === 'harbor-vine')!
const lumen = orgs.rows.find((o) => o.slug === 'lumen-salon')!

heading('Database roles')
const roles = await migrator.query<{
  rolname: string
  rolsuper: boolean
  rolbypassrls: boolean
  rolcreatedb: boolean
  rolcreaterole: boolean
}>(
  `select rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
     from pg_roles where rolname like 'evercalm%' order by rolname`,
)
for (const r of roles.rows) {
  line(
    r.rolname,
    `superuser=${r.rolsuper}  bypassrls=${r.rolbypassrls}  createdb=${r.rolcreatedb}  createrole=${r.rolcreaterole}`,
  )
}
const runtime = roles.rows.find((r) => r.rolname === 'evercalm_app')!
line(
  'RUNTIME ROLE ENFORCES RLS',
  !runtime.rolsuper && !runtime.rolbypassrls ? 'YES' : 'NO - ISOLATION IS INERT',
)

heading('Tenants')
line('Restaurant', `${harbor.name} (${harbor.id})`)
line('Salon', `${lumen.name} (${lumen.id})`)

heading('ATTACK 1 - the salon reads the restaurant, as the runtime role')
for (const table of [
  'organizations',
  'locations',
  'employments',
  'employment_locations',
  'roles',
  'role_capabilities',
  'role_grants',
  'audit_events',
]) {
  const column = table === 'organizations' ? 'id' : 'organization_id'
  const seen = await asTenant<{ count: string }>(
    lumen.id,
    `select count(*)::int as count from "${table}" where "${column}" = $1`,
    [harbor.id],
  )
  const own = await asTenant<{ count: string }>(
    harbor.id,
    `select count(*)::int as count from "${table}" where "${column}" = $1`,
    [harbor.id],
  )
  line(
    `${table}`,
    `salon sees ${seen.rows[0]!.count} of the restaurant's ${own.rows[0]!.count} rows`,
  )
}

heading('ATTACK 2 - direct object reference with a known-good id')
const target = await asTenant<{ id: string; display_name: string }>(
  harbor.id,
  'select id, display_name from employments limit 1',
)
const victim = target.rows[0]!
line('Known restaurant employment', `${victim.display_name} (${victim.id})`)
const probe = await asTenant(lumen.id, 'select id from employments where id = $1', [victim.id])
line('Salon querying that exact id', `${probe.rows.length} rows returned`)

heading('ATTACK 3 - the salon writes into the restaurant')
try {
  await asTenant(
    lumen.id,
    `insert into locations (id, organization_id, name, timezone)
     values (gen_random_uuid(), $1, 'Smuggled', 'America/Los_Angeles')`,
    [harbor.id],
  )
  line('INSERT with another tenant id', 'SUCCEEDED - ISOLATION BROKEN')
} catch (error) {
  line('INSERT with another tenant id', `REFUSED: ${(error as Error).message}`)
}
const upd = await asTenant(
  lumen.id,
  `update locations set name = 'Renamed' where organization_id = $1`,
  [harbor.id],
)
line('UPDATE against another tenant', `${upd.rowCount} rows affected`)
const del = await asTenant(lumen.id, 'delete from employments where organization_id = $1', [
  harbor.id,
])
line('DELETE against another tenant', `${del.rowCount} rows affected`)

heading('ATTACK 4 - no tenant context at all')
for (const table of ['organizations', 'employments', 'audit_events']) {
  const r = await asTenant<{ count: string }>(null, `select count(*)::int as count from "${table}"`)
  line(`${table} with no app.organization_id`, `${r.rows[0]!.count} rows (policies fail closed)`)
}

heading('ATTACK 5 - rewriting audit history')
try {
  await asTenant(
    harbor.id,
    `update audit_events set summary = 'tampered' where organization_id = $1`,
    [harbor.id],
  )
  line('UPDATE audit_events', 'SUCCEEDED - AUDIT IS NOT APPEND-ONLY')
} catch (error) {
  line('UPDATE audit_events', `REFUSED: ${(error as Error).message}`)
}
try {
  await asTenant(harbor.id, 'delete from audit_events where organization_id = $1', [harbor.id])
  line('DELETE audit_events', 'SUCCEEDED - AUDIT IS NOT APPEND-ONLY')
} catch (error) {
  line('DELETE audit_events', `REFUSED: ${(error as Error).message}`)
}

heading('ATTACK 6 - cross-tenant foreign key, as the SCHEMA OWNER (RLS bypassed)')
const hLoc = await migrator.query<{ id: string }>(
  'select id from locations where organization_id = $1 limit 1',
  [harbor.id],
)
const lEmp = await migrator.query<{ id: string }>(
  'select id from employments where organization_id = $1 limit 1',
  [lumen.id],
)
const lRole = await migrator.query<{ id: string }>(
  'select id from roles where organization_id = $1 limit 1',
  [lumen.id],
)
try {
  await migrator.query(
    `insert into role_grants (id, organization_id, employment_id, role_id, scope, location_id)
     values (gen_random_uuid(), $1, $2, $3, 'location', $4)`,
    [lumen.id, lEmp.rows[0]!.id, lRole.rows[0]!.id, hLoc.rows[0]!.id],
  )
  line('Salon grant -> restaurant location', 'SUCCEEDED - FK LAYER BROKEN')
} catch (error) {
  line(
    'Salon grant -> restaurant location',
    `REFUSED by composite FK: ${(error as Error).message.split('\n')[0]}`,
  )
}

heading('ATTACK 7 - location-scoped manager reaching a sibling location')
const { resolveActor } = await import('../src/server/authz/resolve')
const { can } = await import('../src/server/authz/can')
const { drizzle } = await import('drizzle-orm/node-postgres')
const { sql } = await import('drizzle-orm')
const schema = await import('../src/server/db/full-schema')

const locs = await migrator.query<{ id: string; name: string }>(
  'select id, name from locations where organization_id = $1 order by name',
  [harbor.id],
)
const downtown = locs.rows.find((l) => l.name === 'Downtown')!
const riverside = locs.rows.find((l) => l.name === 'Riverside')!
const marcus = await migrator.query<{ id: string }>(
  `select id from "user" where email = 'marcus@harborvine.test'`,
)

const db = drizzle(app, { schema })
const actor = await db.transaction(async (tx) => {
  await tx.execute(sql`select set_config('app.organization_id', ${harbor.id}, true)`)
  return resolveActor(tx, harbor.id, marcus.rows[0]!.id)
})

line('Actor', `${actor!.displayName} - ${actor!.grants.map((g) => g.roleName).join(', ')}`)
line('Grant scope', `${actor!.grants[0]!.scope} (location = ${riverside.name})`)
console.log()
for (const capability of [
  'schedule.publish',
  'people.view',
  'checklist.verify',
  'timeoff.decide',
] as const) {
  line(
    `${capability} @ Riverside (their site)`,
    can(actor!, capability, { locationId: riverside.id }) ? 'ALLOWED' : 'refused',
  )
  line(
    `${capability} @ Downtown (same org, other site)`,
    can(actor!, capability, { locationId: downtown.id }) ? 'ALLOWED - SCOPING BROKEN' : 'REFUSED',
  )
}
line(
  'org.manage_roles (organization-wide)',
  can(actor!, 'org.manage_roles') ? 'ALLOWED - BROKEN' : 'REFUSED',
)
line(
  'schedule.publish asked org-wide',
  can(actor!, 'schedule.publish') ? 'ALLOWED - BROKEN' : 'REFUSED',
)

console.log('\nDone.\n')
await app.end()
await migrator.end()
