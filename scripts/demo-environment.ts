/**
 * The stakeholder-demo database: set it up, and reset it to fictional data.
 *
 *   npm run demo:environment -- setup   # once, with the Neon owner connection
 *   npm run demo:environment -- reset   # any time, restores the demo data
 *
 * Runs from a trusted machine only, never on the web host. Every secret lives
 * in files under ~/.evercalm-demo/ (owner-only), is never printed and is never
 * written inside the repository.
 *
 * setup   Reads DEMOOWNER_DATABASE_URL from ~/.evercalm-demo/neon-owner.env.
 *         Creates two roles with generated passwords - evercalm_migrator (owns
 *         the schema) and evercalm_app (serves requests); neither is a
 *         superuser, creates roles or databases, or bypasses row-level
 *         security - and a database, evercalm_demo, owned by the migrator and
 *         marked with the stakeholder-demo marker. Writes their connection
 *         strings to ~/.evercalm-demo/demo-roles.env. Idempotent.
 *
 * reset   Refuses unless EVERCALM_ENVIRONMENT=stakeholder-demo, the
 *         connection host is DEMO_DATABASE_HOST and the database carries the
 *         demo marker (see src/server/db/demo-guard.ts). Truncates every
 *         application table, reseeds the fictional organizations with a new
 *         unique password per account, and writes the accounts to
 *         ~/.evercalm-demo/stakeholder-accounts.txt and, separately, the
 *         EverCalm staff accounts to ~/.evercalm-demo/staff-accounts.txt.
 */
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from '../src/server/db/full-schema'
import { seedAll } from '../src/server/db/seed'
import { SEED_ORGANIZATIONS } from '../src/server/db/seed/data'
import { SEED_STAFF } from '../src/server/db/seed/launch'
import {
  DEMO_DATABASE_MARKER,
  assertDemoConfiguration,
  assertDemoMarker,
  hostOf,
} from '../src/server/db/demo-guard'

const SECRETS = join(homedir(), '.evercalm-demo')
const OWNER_FILE = join(SECRETS, 'neon-owner.env')
const ROLES_FILE = join(SECRETS, 'demo-roles.env')
const DATABASE = 'evercalm_demo'

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) fail(`Missing ${path}.`)
  const out: Record<string, string> = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (m) out[m[1]!] = m[2]!.replace(/^"(.*)"$/, '$1')
  }
  return out
}

function writePrivate(path: string, contents: string): void {
  mkdirSync(SECRETS, { recursive: true, mode: 0o700 })
  writeFileSync(path, contents, { mode: 0o600 })
  chmodSync(path, 0o600)
}

/** A password with no characters that need escaping in a URL. */
function generatePassword(bytes = 24): string {
  return randomBytes(bytes).toString('base64url')
}

function withDatabase(url: string, database: string, user?: string, password?: string): string {
  const u = new URL(url)
  u.pathname = `/${database}`
  if (user) u.username = user
  if (password) u.password = password
  u.searchParams.set('sslmode', 'require')
  u.searchParams.delete('channel_binding')
  return u.toString()
}

async function setup(): Promise<void> {
  const owner = readEnvFile(OWNER_FILE)
  const ownerDirect = owner.DEMOOWNER_DATABASE_URL_UNPOOLED
  const ownerPooled = owner.DEMOOWNER_DATABASE_URL
  if (!ownerDirect || !ownerPooled) fail('The Neon owner file has no connection strings.')

  const existing = existsSync(ROLES_FILE) ? readEnvFile(ROLES_FILE) : {}
  const migratorPassword = existing.DEMO_MIGRATOR_PASSWORD ?? generatePassword()
  const appPassword = existing.DEMO_APP_PASSWORD ?? generatePassword()
  const ownerUser = decodeURIComponent(new URL(ownerDirect).username)

  const admin = new pg.Client({ connectionString: ownerDirect })
  await admin.connect()
  try {
    for (const [role, password] of [
      ['evercalm_migrator', migratorPassword],
      ['evercalm_app', appPassword],
    ] as const) {
      const { rowCount } = await admin.query('select 1 from pg_roles where rolname = $1', [role])
      const verb = rowCount ? 'alter' : 'create'
      await admin.query(
        `${verb} role ${role} ${verb === 'create' ? 'login ' : ''}password '${password}' nosuperuser nobypassrls nocreatedb nocreaterole`,
      )
    }
    // The owner must be a member to hand the migrator ownership of a database.
    await admin.query(`grant evercalm_migrator to ${pg.escapeIdentifier(ownerUser)}`)
    const { rowCount } = await admin.query('select 1 from pg_database where datname = $1', [
      DATABASE,
    ])
    if (!rowCount) await admin.query(`create database ${DATABASE} owner evercalm_migrator`)
    await admin.query(`comment on database ${DATABASE} is '${DEMO_DATABASE_MARKER}'`)
    await admin.query(`revoke all on database ${DATABASE} from public`)
    await admin.query(`grant connect on database ${DATABASE} to evercalm_app`)
    const { rows } = await admin.query<{
      rolname: string
      rolsuper: boolean
      rolbypassrls: boolean
    }>(
      `select rolname, rolsuper, rolbypassrls from pg_roles where rolname in ('evercalm_migrator','evercalm_app') order by rolname`,
    )
    for (const r of rows) {
      if (r.rolsuper || r.rolbypassrls) fail(`${r.rolname} is privileged; refusing to continue.`)
    }
  } finally {
    await admin.end()
  }

  const migration = withDatabase(ownerDirect, DATABASE, 'evercalm_migrator', migratorPassword)
  const runtime = withDatabase(ownerPooled, DATABASE, 'evercalm_app', appPassword)
  writePrivate(
    ROLES_FILE,
    [
      '# Stakeholder demo database roles. Never commit. Never paste into chat or logs.',
      '# MIGRATION_DATABASE_URL is for this machine only; it never goes into Vercel.',
      `DEMO_MIGRATOR_PASSWORD=${migratorPassword}`,
      `DEMO_APP_PASSWORD=${appPassword}`,
      `MIGRATION_DATABASE_URL=${migration}`,
      `DATABASE_URL=${runtime}`,
      `DEMO_DATABASE_HOST=${hostOf(ownerDirect)}`,
      '',
    ].join('\n'),
  )
  console.log('Demo database ready: roles evercalm_migrator and evercalm_app (neither privileged),')
  console.log(
    `database ${DATABASE}, marked for the stakeholder demo. Connection strings written to`,
  )
  console.log(ROLES_FILE)
}

async function reset(): Promise<void> {
  const url = process.env.MIGRATION_DATABASE_URL
  if (!url) fail('MIGRATION_DATABASE_URL is not set.')
  assertDemoConfiguration({
    environment: process.env.EVERCALM_ENVIRONMENT,
    configuredHost: process.env.DEMO_DATABASE_HOST,
    connectionString: url,
  })

  const pool = new pg.Pool({ connectionString: url, max: 2 })
  try {
    const { rows } = await pool.query<{ comment: string | null }>(
      'select shobj_description(oid, $1) as comment from pg_database where datname = current_database()',
      ['pg_database'],
    )
    assertDemoMarker(rows[0]?.comment)

    const tables = await pool.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public' and tablename <> 'evercalm_migrations'`,
    )
    if (tables.rows.length === 0)
      fail('No tables: run the migrations against the demo database first.')
    await pool.query(
      `truncate table ${tables.rows.map((r) => `"${r.tablename}"`).join(', ')} restart identity cascade`,
    )

    const passwords = new Map<string, string>()
    const passwordFor = (email: string) => {
      if (!passwords.has(email)) passwords.set(email, generatePassword(18))
      return passwords.get(email)!
    }
    const summary = await seedAll(drizzle(pool, { schema }), { passwordFor })

    const staffEmails = new Set<string>(SEED_STAFF.map((s) => s.email))
    const lines = (filter: (email: string) => boolean) =>
      SEED_ORGANIZATIONS.flatMap((org) =>
        org.people
          .filter((p) => filter(p.email) && passwords.has(p.email))
          .map((p) => `${org.name}\t${p.displayName}\t${p.email}\t${passwords.get(p.email)}`),
      )
    const header = (title: string) =>
      `# ${title}\n# Stakeholder Demo accounts. Private: never commit, paste into chat, or put in documents.\n# Passwords change every time the demo is reset.\n`
    writePrivate(
      join(SECRETS, 'stakeholder-accounts.txt'),
      `${header('Customer accounts (fictional people)')}Organization\tName\tEmail\tPassword\n${lines((e) => !staffEmails.has(e)).join('\n')}\n`,
    )
    writePrivate(
      join(SECRETS, 'staff-accounts.txt'),
      `${header('EverCalm internal staff accounts - give to nobody else')}Name\tEmail\tPassword\n${SEED_STAFF.map(
        (s) => `${s.name}\t${s.email}\t${passwords.get(s.email) ?? ''}`,
      ).join('\n')}\n`,
    )
    const people = summary.organizations.reduce((n, o) => n + (o.people ?? 0), 0)
    console.log(
      `Stakeholder demo reset: ${summary.organizations.length} organizations, ${people} people, ${SEED_STAFF.length} EverCalm staff.`,
    )
    console.log(
      `Account files (owner-only): ${join(SECRETS, 'stakeholder-accounts.txt')} and staff-accounts.txt`,
    )
  } finally {
    await pool.end()
  }
}

const command = process.argv[2]
if (command === 'setup') await setup()
else if (command === 'reset') await reset()
else fail('Usage: npm run demo:environment -- setup | reset')
