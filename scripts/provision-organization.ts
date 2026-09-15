/**
 * Provision one real customer organization.
 *
 *   npm run provision:organization -- --file ./org.json            # dry run
 *   npm run provision:organization -- --file ./org.json --apply    # do it
 *   npm run provision:organization -- --file ./org.json --apply --reissue-invitation
 *
 * Needs MIGRATION_DATABASE_URL (the schema-owning role) and APP_URL (for the
 * owner's invitation link). Run it from a trusted machine or a protected
 * workflow only - never on the web host. It never creates passwords or demo
 * data, and running it twice changes nothing the second time. See
 * docs/runbooks/provision-organization.md.
 */
import { readFileSync } from 'node:fs'
import { config } from 'dotenv'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from '../src/server/db/full-schema'
import { parseProvisionSpec, provisionOrganization } from '../src/server/db/provision'

config({ path: '.env.local', quiet: true })
config({ quiet: true })

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(name)
const fileIndex = args.indexOf('--file')
const file = fileIndex >= 0 ? args[fileIndex + 1] : undefined

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

if (!file)
  fail(
    'Usage: npm run provision:organization -- --file <organization.json> [--apply] [--reissue-invitation]',
  )
const url = process.env.MIGRATION_DATABASE_URL
if (!url)
  fail(
    'MIGRATION_DATABASE_URL is not set. Provisioning runs as the migration role, from a trusted machine.',
  )
const appUrl = process.env.APP_URL
if (!appUrl || !/^https?:\/\//.test(appUrl))
  fail('APP_URL must be the public origin people sign in at, e.g. https://app.your-domain')

let raw: unknown
try {
  raw = JSON.parse(readFileSync(file, 'utf8'))
} catch (error) {
  fail(`Could not read ${file}: ${error instanceof Error ? error.message : String(error)}`)
}
const parsed = parseProvisionSpec(raw)
if (!parsed.ok) fail(`The file is not valid:\n  - ${parsed.errors.join('\n  - ')}`)

const apply = flag('--apply')
const pool = new pg.Pool({
  connectionString: url,
  max: 1,
  ssl: /\bsslmode=require\b/.test(url) ? { rejectUnauthorized: true } : undefined,
})

try {
  const report = await provisionOrganization(drizzle(pool, { schema }), parsed.spec, {
    apply,
    appUrl,
    reissueInvitation: flag('--reissue-invitation'),
  })
  const database = new URL(url).hostname
  console.warn(
    `\n${apply ? 'APPLIED' : 'DRY RUN (nothing was saved; add --apply)'} against ${database}\n`,
  )
  console.warn(
    `Organization  ${parsed.spec.organization.name} (${parsed.spec.organization.slug}): ${report.organization.action}`,
  )
  for (const l of report.locations)
    console.warn(`Location      ${l.name}: ${l.action}${l.note ? ` (${l.note})` : ''}`)
  console.warn(
    `Roles         ${report.roles.created} created, ${report.roles.existing} already there`,
  )
  console.warn(
    `Categories    ${report.categories.created} created, ${report.categories.existing} already there`,
  )
  console.warn(`Subscription  manual pilot: ${report.subscription}`)
  switch (report.owner.action) {
    case 'already_member':
      console.warn('Owner         already a member; no invitation needed')
      break
    case 'invitation_pending':
      console.warn(
        `Owner         invitation already pending until ${report.owner.expiresAt.toISOString()}; use --reissue-invitation for a new link`,
      )
      break
    default:
      console.warn(
        `Owner         ${report.owner.action}, expires ${report.owner.expiresAt.toISOString()}`,
      )
      if (report.owner.acceptUrl) {
        console.warn(
          '\nOwner invitation link - shown once, works once. Send it to the owner privately:',
        )
        console.warn(report.owner.acceptUrl)
      }
  }
  for (const note of report.notes) console.warn(`Note          ${note}`)
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
} finally {
  await pool.end()
}
