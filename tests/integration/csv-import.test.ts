import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { previewImport, runImport, errorReportCsv } from '@/modules/people/import-service'
import { listEmployments } from '@/modules/people/service'
import { listInvitations } from '@/modules/invitations/service'
import { resolveActor } from '@/server/authz/resolve'
import type { Actor } from '@/server/authz/actor'
import { ForbiddenError, ValidationError } from '@/lib/errors'
import { parseCsv } from '@/modules/people/csv'
import { asTenant, closeTestPools, migrationClient, organizationIdBySlug } from '../helpers/tenant'

/**
 * CSV IMPORT, against the SALON tenant.
 *
 * Deliberately the salon: if the importer had quietly assumed restaurant roles
 * or vocabulary, matching "Stylist" and "Pearl District" would fail here while
 * passing in Harbor & Vine.
 */

const APP_URL = 'http://localhost:3000'

let harborId: string
let lumenId: string
const userIds = new Map<string, string>()

beforeAll(async () => {
  harborId = await organizationIdBySlug('harbor-vine')
  lumenId = await organizationIdBySlug('lumen-salon')
  const pool = await migrationClient()
  const users = await pool.query<{ id: string; email: string }>('select id, email from "user"')
  for (const row of users.rows) userIds.set(row.email, row.id)
})

afterAll(async () => {
  await closeTestPools()
})

async function actorFor(organizationId: string, email: string): Promise<Actor> {
  const userId = userIds.get(email)
  if (!userId) throw new Error(`Seeded user ${email} not found`)
  const actor = await asTenant(organizationId, (tx) => resolveActor(tx, organizationId, userId))
  if (!actor) throw new Error(`No actor for ${email}`)
  return actor
}

function unique(prefix: string): string {
  return `${prefix}.${Date.now()}.${Math.floor(Math.random() * 100_000)}@example.test`
}

describe('matching against the salon tenant', () => {
  it('matches salon locations, job roles, and managers by name', async () => {
    const ana = await actorFor(lumenId, 'ana@lumensalon.test')
    const csv = [
      'Full name,Email,Job title,Salon,Role,Reports to,Start date',
      `Nadia Okonjo,${unique('nadia')},Stylist,Pearl District,Stylist,kofi@lumensalon.test,2026-09-15`,
      `Beau Tran,${unique('beau')},Massage Therapist,Boise Bench,Massage Therapist,Sierra Whitehorse,2026-09-20`,
    ].join('\n')

    const preview = await asTenant(lumenId, (tx) => previewImport(tx, ana, csv))

    expect(preview.fileError).toBeNull()
    expect(preview.validCount).toBe(2)
    expect(preview.invalidCount).toBe(0)

    const [nadia, beau] = preview.rows
    expect(nadia!.locationId, 'Pearl District should match').not.toBeNull()
    expect(nadia!.jobRoleId, 'Stylist should match').not.toBeNull()
    expect(nadia!.managerEmploymentId, 'manager by email should match').not.toBeNull()
    expect(nadia!.hiredOn).toBe('2026-09-15')

    // The salon's own words: "Salon" as the location header, a therapist role
    // no restaurant has, and a manager matched by full name.
    expect(beau!.locationId).not.toBeNull()
    expect(beau!.jobRoleId).not.toBeNull()
    expect(beau!.managerEmploymentId, 'manager by name should match').not.toBeNull()
  })

  it('reports a location or role the salon does not have, naming it', async () => {
    const ana = await actorFor(lumenId, 'ana@lumensalon.test')
    // Restaurant vocabulary in a salon: both should fail, by name.
    const csv = [
      'Full name,Email,Location,Role',
      `Wrong Words,${unique('wrong')},Riverside,Line Cook`,
    ].join('\n')

    const preview = await asTenant(lumenId, (tx) => previewImport(tx, ana, csv))
    const row = preview.rows[0]!

    expect(row.valid).toBe(false)
    expect(row.issues.map((i) => i.message).join(' ')).toContain('Riverside')
    expect(row.issues.map((i) => i.message).join(' ')).toContain('Line Cook')
  })
})

describe('validation against existing people', () => {
  it('detects somebody who already works here', async () => {
    const ana = await actorFor(lumenId, 'ana@lumensalon.test')
    const csv = ['Full name,Email', 'Marisol Vega,marisol@lumensalon.test'].join('\n')

    const preview = await asTenant(lumenId, (tx) => previewImport(tx, ana, csv))
    expect(preview.rows[0]!.valid).toBe(false)
    expect(preview.rows[0]!.issues[0]!.message).toMatch(/already works here/i)
  })

  it('does NOT reveal that an address exists in another organization', async () => {
    const ana = await actorFor(lumenId, 'ana@lumensalon.test')
    // Sam works at the restaurant, not the salon. To the salon he is simply a
    // new person - anything else would be a cross-tenant disclosure.
    const csv = ['Full name,Email', 'Sam Whitfield,sam@harborvine.test'].join('\n')

    const preview = await asTenant(lumenId, (tx) => previewImport(tx, ana, csv))
    expect(preview.rows[0]!.valid, 'a colleague of another tenant is just a new person').toBe(true)
    expect(JSON.stringify(preview.rows[0]!.issues)).not.toMatch(/Harbor/i)
  })

  it('does not match a manager from another organization', async () => {
    const ana = await actorFor(lumenId, 'ana@lumensalon.test')
    const csv = [
      'Full name,Email,Manager',
      `Cross Manager,${unique('crossmgr')},marcus@harborvine.test`,
    ].join('\n')

    const preview = await asTenant(lumenId, (tx) => previewImport(tx, ana, csv))
    expect(preview.rows[0]!.valid).toBe(false)
    expect(preview.rows[0]!.issues[0]!.message).toMatch(/No colleague matching/i)
  })
})

describe('the organization always comes from the session', () => {
  it('ignores an organization column entirely', async () => {
    const ana = await actorFor(lumenId, 'ana@lumensalon.test')
    const email = unique('tenantjump')
    const csv = ['organization_id,Full name,Email', `${harborId},Tenant Jumper,${email}`].join('\n')

    const preview = await asTenant(lumenId, (tx) => previewImport(tx, ana, csv))
    // The column is simply not a field the importer knows about.
    expect(preview.unmappedHeaders).toContain('organization_id')
    expect(preview.validCount).toBe(1)

    await asTenant(lumenId, (tx) =>
      runImport(tx, ana, csv, { sendInvitations: false, appUrl: APP_URL }),
    )

    const pool = await migrationClient()
    const { rows } = await pool.query<{ organization_id: string }>(
      'select organization_id from employments where email = $1',
      [email],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.organization_id, 'must land in the ACTING tenant').toBe(lumenId)
    expect(rows[0]!.organization_id).not.toBe(harborId)
  })
})

describe('preview writes nothing', () => {
  it('creates no employment and no invitation', async () => {
    const ana = await actorFor(lumenId, 'ana@lumensalon.test')
    const email = unique('previewonly')
    const csv = ['Full name,Email', `Preview Only,${email}`].join('\n')

    const before = await asTenant(lumenId, (tx) => listEmployments(tx, ana))
    await asTenant(lumenId, (tx) => previewImport(tx, ana, csv))
    const after = await asTenant(lumenId, (tx) => listEmployments(tx, ana))

    expect(after.length).toBe(before.length)

    const pool = await migrationClient()
    const invites = await pool.query('select id from invitations where email = $1', [email])
    expect(invites.rows).toHaveLength(0)
  })
})

describe('importing', () => {
  it('creates people as invited, so an import never grants access', async () => {
    const ana = await actorFor(lumenId, 'ana@lumensalon.test')
    const email = unique('invitedstatus')
    const csv = ['Full name,Email,Role,Salon', `Status Check,${email},Stylist,Pearl District`].join(
      '\n',
    )

    const outcome = await asTenant(lumenId, (tx) =>
      runImport(tx, ana, csv, { sendInvitations: false, appUrl: APP_URL }),
    )
    expect(outcome.imported).toBe(1)
    expect(outcome.invited).toBe(0)

    const pool = await migrationClient()
    const { rows } = await pool.query<{ status: string; user_id: string | null }>(
      'select status, user_id from employments where email = $1',
      [email],
    )
    expect(rows[0]!.status).toBe('invited')
    expect(rows[0]!.user_id, 'an import must never create a sign-in').toBeNull()
  })

  it('sends invitations only when explicitly asked', async () => {
    const ana = await actorFor(lumenId, 'ana@lumensalon.test')
    const quiet = unique('quiet')
    const loud = unique('loud')

    await asTenant(lumenId, (tx) =>
      runImport(tx, ana, ['Full name,Email', `Quiet Import,${quiet}`].join('\n'), {
        sendInvitations: false,
        appUrl: APP_URL,
      }),
    )
    const outcome = await asTenant(lumenId, (tx) =>
      runImport(tx, ana, ['Full name,Email', `Loud Import,${loud}`].join('\n'), {
        sendInvitations: true,
        appUrl: APP_URL,
      }),
    )

    expect(outcome.invited).toBe(1)

    const invitations = await asTenant(lumenId, (tx) => listInvitations(tx, ana))
    const emails = invitations.map((i) => i.email)
    expect(emails).toContain(loud)
    expect(emails, 'no invitation should exist for the quiet import').not.toContain(quiet)
  })

  it('links an invitation to the imported record instead of duplicating the person', async () => {
    const ana = await actorFor(lumenId, 'ana@lumensalon.test')
    const email = unique('linked')
    await asTenant(lumenId, (tx) =>
      runImport(tx, ana, ['Full name,Email', `Linked Person,${email}`].join('\n'), {
        sendInvitations: true,
        appUrl: APP_URL,
      }),
    )

    const pool = await migrationClient()
    const employment = await pool.query<{ id: string }>(
      'select id from employments where email = $1',
      [email],
    )
    const invitation = await pool.query<{ target_employment_id: string }>(
      'select target_employment_id from invitations where email = $1',
      [email],
    )
    expect(employment.rows).toHaveLength(1)
    expect(invitation.rows[0]!.target_employment_id).toBe(employment.rows[0]!.id)
  })

  it('is all or nothing', async () => {
    const ana = await actorFor(lumenId, 'ana@lumensalon.test')
    // No valid rows at all, so the whole import is refused rather than
    // partially applied.
    const csv = ['Full name,Email', 'No Email,', ',orphan@example.test'].join('\n')

    await expect(
      asTenant(lumenId, (tx) =>
        runImport(tx, ana, csv, { sendInvitations: false, appUrl: APP_URL }),
      ),
    ).rejects.toThrow(ValidationError)
  })

  it('imports the valid rows and skips the invalid ones, reporting both', async () => {
    const ana = await actorFor(lumenId, 'ana@lumensalon.test')
    const good = unique('mixedgood')
    const csv = [
      'Full name,Email,Role',
      `Good Row,${good},Stylist`,
      `Bad Role,${unique('mixedbad')},Line Cook`,
    ].join('\n')

    const outcome = await asTenant(lumenId, (tx) =>
      runImport(tx, ana, csv, { sendInvitations: false, appUrl: APP_URL }),
    )
    expect(outcome.imported).toBe(1)
    expect(outcome.skipped).toBe(1)

    const people = await asTenant(lumenId, (tx) => listEmployments(tx, ana, { query: 'Good Row' }))
    expect(people).toHaveLength(1)
    const missing = await asTenant(lumenId, (tx) => listEmployments(tx, ana, { query: 'Bad Role' }))
    expect(missing).toHaveLength(0)
  })

  it('records one audit event with counts and no personal details', async () => {
    const ana = await actorFor(lumenId, 'ana@lumensalon.test')
    const email = unique('audited')
    await asTenant(lumenId, (tx) =>
      runImport(tx, ana, ['Full name,Email', `Audited Person,${email}`].join('\n'), {
        sendInvitations: false,
        appUrl: APP_URL,
      }),
    )

    const pool = await migrationClient()
    const { rows } = await pool.query<{ summary: string; metadata: Record<string, unknown> }>(
      `select summary, metadata from audit_events
        where organization_id = $1 and action = 'people.imported'
        order by created_at desc limit 1`,
      [lumenId],
    )
    expect(rows[0]!.summary).toMatch(/Imported 1 person/)
    // Counts only. Audit metadata must not become a store of contact details.
    expect(JSON.stringify(rows[0]!.metadata)).not.toContain(email)
    expect(rows[0]!.metadata.imported).toBe(1)
  })
})

describe('authorization', () => {
  it('refuses somebody without people.invite', async () => {
    const riley = await asTenant(lumenId, (tx) =>
      resolveActor(tx, lumenId, userIds.get('riley@lumensalon.test')!),
    )
    const csv = ['Full name,Email', `Nope,${unique('nope')}`].join('\n')

    await expect(asTenant(lumenId, (tx) => previewImport(tx, riley!, csv))).rejects.toThrow(
      ForbiddenError,
    )
    await expect(
      asTenant(lumenId, (tx) =>
        runImport(tx, riley!, csv, { sendInvitations: false, appUrl: APP_URL }),
      ),
    ).rejects.toThrow(ForbiddenError)
  })
})

describe('the error report is safe to open', () => {
  it('neutralises a formula smuggled through a name field', async () => {
    const ana = await actorFor(lumenId, 'ana@lumensalon.test')
    // A hostile row: the name is a formula AND the row is invalid, so it lands
    // in the error report that an administrator will open in a spreadsheet.
    const csv = ['Full name,Email', '=HYPERLINK("http://evil.test"),not-an-email'].join('\n')

    const preview = await asTenant(lumenId, (tx) => previewImport(tx, ana, csv))
    expect(preview.invalidCount).toBe(1)

    const report = errorReportCsv(preview)
    const parsed = parseCsv(report)
    const nameCell = parsed[1]?.[1] ?? ''

    expect(nameCell.startsWith('=')).toBe(false)
    expect(nameCell.startsWith("'")).toBe(true)
  })

  it('contains only the invalid rows', async () => {
    const ana = await actorFor(lumenId, 'ana@lumensalon.test')
    const csv = [
      'Full name,Email',
      `Fine Person,${unique('fine')}`,
      'Broken Person,not-an-email',
    ].join('\n')

    const preview = await asTenant(lumenId, (tx) => previewImport(tx, ana, csv))
    const parsed = parseCsv(errorReportCsv(preview))

    expect(parsed).toHaveLength(2) // header + one bad row
    expect(parsed[1]?.[1]).toBe('Broken Person')
  })
})

describe('column mapping', () => {
  it('honours an explicit mapping over the detected one', async () => {
    const ana = await actorFor(lumenId, 'ana@lumensalon.test')
    const email = unique('mapped')
    // Headers nothing would recognise, mapped by hand.
    const csv = ['Column A,Column B', `Hand Mapped,${email}`].join('\n')

    const detected = await asTenant(lumenId, (tx) => previewImport(tx, ana, csv))
    expect(detected.fileError, 'unrecognised headers should ask for a mapping').toMatch(
      /Map a column/i,
    )

    const mapped = await asTenant(lumenId, (tx) =>
      previewImport(tx, ana, csv, { 0: 'displayName', 1: 'email' }),
    )
    expect(mapped.fileError).toBeNull()
    expect(mapped.validCount).toBe(1)
    expect(mapped.rows[0]!.displayName).toBe('Hand Mapped')
  })

  it('refuses to proceed without a name and an email column', async () => {
    const ana = await actorFor(lumenId, 'ana@lumensalon.test')
    const csv = ['Job title,Location', 'Stylist,Pearl District'].join('\n')
    const preview = await asTenant(lumenId, (tx) => previewImport(tx, ana, csv))
    expect(preview.fileError).toMatch(/Full name and Email/i)
    expect(preview.rows).toHaveLength(0)
  })
})
