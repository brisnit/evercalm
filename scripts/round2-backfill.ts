/**
 * Round 2 backfill: give an already-seeded database the data the round 2
 * features need, WITHOUT resetting or reseeding it.
 *
 * The stakeholder demo was seeded before round 2 existed, so its people have
 * no contact details, almost no declared availability, and there are no
 * channels, documents or schedule templates at all. Round 2's screens work
 * without them, but they work on an empty stage: autofill cannot look good
 * against five availability rules, and a document hub with nothing in it
 * demonstrates nothing.
 *
 * STRICTLY ADDITIVE. Every step is guarded by "does this already exist?" and
 * there is no DELETE and no overwrite anywhere in this file:
 *
 *   contact details      only where the phone is null
 *   availability         only for people who have declared nothing
 *   channels, messages   only if the organization has no channels
 *   direct threads       only if it has none
 *   documents            only if it has none
 *   schedule templates   only if it has none
 *
 * Running it twice does nothing the second time. It is not the reset command
 * and cannot become one - see docs/runbooks/stakeholder-demo.md.
 *
 * Usage: MIGRATION_DATABASE_URL=... npx tsx scripts/round2-backfill.ts [--commit]
 * Without --commit it reports what it would do and changes nothing.
 */
import { config } from 'dotenv'
import { drizzle } from 'drizzle-orm/node-postgres'
import { and, eq } from 'drizzle-orm'
import pg from 'pg'
import * as schema from '../src/server/db/full-schema'
import { SEED_ORGANIZATIONS } from '../src/server/db/seed/data'
import { seedContact } from '../src/server/db/seed/contact'
import { availabilityPlan, seedAvailability } from '../src/server/db/seed/availability'
import { seedMessaging } from '../src/server/db/seed/messaging'
import { seedDocuments } from '../src/server/db/seed/documents'
import { seedSlottedTemplates } from '../src/server/db/seed/slotted'

config({ path: '.env.local', quiet: true })
config({ quiet: true })

const commit = process.argv.includes('--commit')
const url = process.env.MIGRATION_DATABASE_URL
if (!url) {
  console.error('MIGRATION_DATABASE_URL is not set.')
  process.exit(1)
}

const pool = new pg.Pool({
  connectionString: url,
  ssl: /\bsslmode=require\b/.test(url) ? { rejectUnauthorized: true } : undefined,
  max: 2,
})
const db = drizzle(pool, { schema })

async function main() {
  console.log(commit ? 'Applying the round 2 backfill.' : 'Dry run. Nothing will be written.')

  for (const org of SEED_ORGANIZATIONS) {
    const [row] = await db
      .select({ id: schema.organizations.id })
      .from(schema.organizations)
      .where(eq(schema.organizations.slug, org.slug))
    if (!row) {
      console.log(`  - ${org.slug}: not in this database, skipped`)
      continue
    }
    const organizationId = row.id

    const people = await db
      .select({
        id: schema.employments.id,
        email: schema.employments.email,
        phone: schema.employments.phone,
      })
      .from(schema.employments)
      .where(eq(schema.employments.organizationId, organizationId))
    const locations = await db
      .select({ id: schema.locations.id, name: schema.locations.name })
      .from(schema.locations)
      .where(eq(schema.locations.organizationId, organizationId))
    const roles = await db
      .select({ id: schema.jobRoles.id, name: schema.jobRoles.name })
      .from(schema.jobRoles)
      .where(eq(schema.jobRoles.organizationId, organizationId))

    const byKey = new Map<string, string>()
    for (const person of org.people) {
      const match = people.find((p) => p.email === person.email)
      if (match) byKey.set(person.key, match.id)
    }
    const locationIds = new Map(
      org.locations
        .map((l) => [l.key, locations.find((x) => x.name === l.name)?.id] as const)
        .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
    )
    const jobRoleIds = new Map(
      org.jobRoles
        .map((r) => [r.key, roles.find((x) => x.name === r.name)?.id] as const)
        .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
    )

    // --- contact details, only where there are none ------------------------
    let contacts = 0
    for (const person of org.people) {
      const match = people.find((p) => p.email === person.email)
      if (!match || match.phone) continue
      contacts += 1
      if (commit) {
        await db
          .update(schema.employments)
          .set(seedContact(person, org.areaCode))
          .where(
            and(
              eq(schema.employments.organizationId, organizationId),
              eq(schema.employments.id, match.id),
            ),
          )
      }
    }

    // --- availability, only for people who declared nothing ----------------
    const declared = await db
      .select({ employmentId: schema.availabilityRules.employmentId })
      .from(schema.availabilityRules)
      .where(eq(schema.availabilityRules.organizationId, organizationId))
    const skip = new Set(declared.map((d) => d.employmentId))
    const plan = availabilityPlan(org.slug)
    const wouldDeclare = Object.keys(plan).filter((key) => {
      const id = byKey.get(key)
      return id && !skip.has(id)
    }).length
    let availability = 0
    if (commit && wouldDeclare > 0) {
      availability = (
        await seedAvailability(db, { organizationId, slug: org.slug, employmentIds: byKey, skip })
      ).rules
    }

    // --- channels and direct messages, only if there are none --------------
    const channels = await db
      .select({ id: schema.channels.id })
      .from(schema.channels)
      .where(eq(schema.channels.organizationId, organizationId))
    let messaging = { channels: 0, threads: 0, messages: 0 }
    if (channels.length === 0 && commit) {
      messaging = await seedMessaging(db, { organizationId, slug: org.slug, employmentIds: byKey })
    }

    // --- documents, only if there are none ---------------------------------
    const documents = await db
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(eq(schema.documents.organizationId, organizationId))
    let docs = { documents: 0 }
    if (documents.length === 0 && commit) {
      docs = await seedDocuments(db, {
        organizationId,
        slug: org.slug,
        locationIds,
        employmentIds: byKey,
      })
    }

    // --- a named week per location, only if there is none ------------------
    const templates = await db
      .select({ id: schema.scheduleTemplates.id })
      .from(schema.scheduleTemplates)
      .where(eq(schema.scheduleTemplates.organizationId, organizationId))
    let sets = { templates: 0, patterns: 0 }
    if (templates.length === 0 && commit) {
      sets = await seedSlottedTemplates(db, {
        organizationId,
        slug: org.slug,
        locationIds,
        jobRoleIds,
        employmentIds: byKey,
      })
    }

    console.log(
      `  ${org.slug}: ` +
        [
          `contact details ${commit ? contacts : `${contacts} pending`}`,
          `availability ${commit ? availability : `${wouldDeclare} people pending`}`,
          `channels ${channels.length > 0 ? 'already present' : commit ? messaging.channels : 'pending'}`,
          `documents ${documents.length > 0 ? 'already present' : commit ? docs.documents : 'pending'}`,
          `templates ${templates.length > 0 ? 'already present' : commit ? sets.templates : 'pending'}`,
        ].join(' · '),
    )
  }

  if (!commit) console.log('\nDry run only. Re-run with --commit to write.')
}

try {
  await main()
} finally {
  await pool.end()
}
