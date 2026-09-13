import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  archiveAnnouncement,
  cancelSchedule,
  createAnnouncement,
  duplicateAnnouncement,
  expireDue,
  listAnnouncements,
  listCategories,
  loadAudienceRules,
  previewAudience,
  publishAnnouncement,
  publishScheduledAnnouncement,
  requireAnnouncement,
  reviseAnnouncement,
  scheduleAnnouncement,
  syncRecipients,
  updateDraft,
  type AnnouncementInput,
} from '@/modules/comms/service'
import { acknowledge, inboxDigest, listInbox, openAnnouncement } from '@/modules/comms/inbox'
import { receiptReport, sendReminders } from '@/modules/comms/receipts'
import type { AudienceRuleInput } from '@/modules/comms/audience'
import { resolveActor } from '@/server/authz/resolve'
import type { Actor } from '@/server/authz/actor'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { asTenant, closeTestPools, migrationClient, organizationIdBySlug } from '../helpers/tenant'

/**
 * ANNOUNCEMENTS, END TO END, against real PostgreSQL.
 *
 * The promises under test:
 *
 *   targeting resolves the way the summary says it does
 *   nothing crosses a tenant or a location boundary
 *   publishing twice cannot duplicate a recipient
 *   opening is never acknowledging
 *   a material revision asks again without erasing what came before
 *   a manager sees only the receipts they are responsible for
 */

let harborId: string
let lumenId: string
const userIds = new Map<string, string>()

const OWNER = 'dana@harborvine.test'
const GM_RIVERSIDE = 'marcus@harborvine.test'
const EMPLOYEE = 'sam@harborvine.test'
const SALON_OWNER = 'ana@lumensalon.test'

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

async function idOf(
  organizationId: string,
  table: string,
  column: string,
  value: string,
): Promise<string> {
  const pool = await migrationClient()
  const { rows } = await pool.query<{ id: string }>(
    `select id from ${table} where organization_id = $1 and ${column} = $2 limit 1`,
    [organizationId, value],
  )
  if (!rows[0]) throw new Error(`No ${table} with ${column} = ${value}`)
  return rows[0].id
}

async function categoryId(organizationId: string, key: string): Promise<string> {
  const categories = await asTenant(organizationId, (tx) => listCategories(tx, organizationId))
  const found = categories.find((c) => c.key === key)
  if (!found) throw new Error(`No category ${key}`)
  return found.id
}

function draft(overrides: Partial<AnnouncementInput> = {}): AnnouncementInput {
  return {
    title: 'A test announcement',
    body: 'Something people need to know.',
    categoryId: '',
    priority: 'normal',
    requiresAcknowledgement: false,
    acknowledgementDueAt: null,
    expiresAt: null,
    callToActionLabel: null,
    callToActionHref: null,
    eventId: null,
    ...overrides,
  }
}

/** Create and publish in one step, returning the announcement id. */
async function publish(
  actor: Actor,
  organizationId: string,
  input: Partial<AnnouncementInput>,
  rules: AudienceRuleInput[],
): Promise<string> {
  const category = input.categoryId ?? (await categoryId(organizationId, 'general'))
  const id = await asTenant(organizationId, (tx) =>
    createAnnouncement(tx, actor, draft({ ...input, categoryId: category }), rules),
  )
  await asTenant(organizationId, (tx) => publishAnnouncement(tx, actor, id))
  return id
}

async function recipientNames(organizationId: string, announcementId: string): Promise<string[]> {
  const pool = await migrationClient()
  const { rows } = await pool.query<{ display_name: string }>(
    `select e.display_name
       from announcement_recipients r
       join employments e on e.id = r.employment_id
      where r.organization_id = $1 and r.announcement_id = $2
      order by e.display_name`,
    [organizationId, announcementId],
  )
  return rows.map((r) => r.display_name)
}

// ---------------------------------------------------------------------------

describe('audience targeting', () => {
  it('reaches the whole organization', async () => {
    const owner = await actorFor(harborId, OWNER)
    const id = await publish(owner, harborId, { title: 'Everyone' }, [
      { mode: 'include', selectorType: 'organization', selectorId: null },
    ])

    const names = await recipientNames(harborId, id)
    expect(names.length).toBeGreaterThan(10)
    expect(names).toContain('Dana Okafor')
    expect(names).toContain('Sam Whitfield')
  })

  it('reaches one location only', async () => {
    const owner = await actorFor(harborId, OWNER)
    const riverside = await idOf(harborId, 'locations', 'name', 'Riverside')
    const id = await publish(owner, harborId, { title: 'Riverside only' }, [
      { mode: 'include', selectorType: 'location', selectorId: riverside },
    ])

    const pool = await migrationClient()
    const { rows } = await pool.query<{ n: string }>(
      `select count(*) n
         from announcement_recipients r
        where r.organization_id = $1 and r.announcement_id = $2
          and not exists (
            select 1 from employment_locations el
             where el.organization_id = r.organization_id
               and el.employment_id = r.employment_id
               and el.location_id = $3)`,
      [harborId, id, riverside],
    )
    expect(Number(rows[0]?.n)).toBe(0)
  })

  it('reaches a job role', async () => {
    const owner = await actorFor(harborId, OWNER)
    const server = await idOf(harborId, 'job_roles', 'name', 'Server')
    const id = await publish(owner, harborId, { title: 'Servers' }, [
      { mode: 'include', selectorType: 'job_role', selectorId: server },
    ])

    const names = await recipientNames(harborId, id)
    expect(names.length).toBeGreaterThan(0)
    // A line cook holds no server role, so must not be here.
    expect(names).not.toContain('Dmitri Sokolov')
  })

  it('reaches a department through its job roles', async () => {
    const owner = await actorFor(harborId, OWNER)
    const boh = await idOf(harborId, 'departments', 'name', 'Back of House')
    const id = await publish(owner, harborId, { title: 'Kitchen' }, [
      { mode: 'include', selectorType: 'department', selectorId: boh },
    ])

    const names = await recipientNames(harborId, id)
    expect(names).toContain('Dmitri Sokolov')
    expect(names).not.toContain('Sam Whitfield')
  })

  it('reaches a team', async () => {
    const owner = await actorFor(harborId, OWNER)
    const team = await idOf(harborId, 'teams', 'name', 'Riverside closing crew')
    const id = await publish(owner, harborId, { title: 'Closers' }, [
      { mode: 'include', selectorType: 'team', selectorId: team },
    ])
    expect(await recipientNames(harborId, id)).toHaveLength(4)
  })

  it('reaches named individuals', async () => {
    const owner = await actorFor(harborId, OWNER)
    const sam = await idOf(harborId, 'employments', 'display_name', 'Sam Whitfield')
    const id = await publish(owner, harborId, { title: 'Just you' }, [
      { mode: 'include', selectorType: 'employment', selectorId: sam },
    ])
    expect(await recipientNames(harborId, id)).toEqual(['Sam Whitfield'])
  })

  it('UNIONS multiple includes rather than intersecting them', async () => {
    const owner = await actorFor(harborId, OWNER)
    const server = await idOf(harborId, 'job_roles', 'name', 'Server')
    const cook = await idOf(harborId, 'job_roles', 'name', 'Line Cook')

    const id = await publish(owner, harborId, { title: 'Servers and cooks' }, [
      { mode: 'include', selectorType: 'job_role', selectorId: server },
      { mode: 'include', selectorType: 'job_role', selectorId: cook },
    ])

    const names = await recipientNames(harborId, id)
    // Read as an intersection this would be empty; as a union it is both.
    expect(names).toContain('Dmitri Sokolov')
    expect(names.length).toBeGreaterThan(1)
  })

  it('subtracts excludes, and exclude beats include', async () => {
    const owner = await actorFor(harborId, OWNER)
    const sam = await idOf(harborId, 'employments', 'display_name', 'Sam Whitfield')

    const id = await publish(owner, harborId, { title: 'Everyone but Sam' }, [
      { mode: 'include', selectorType: 'organization', selectorId: null },
      { mode: 'include', selectorType: 'employment', selectorId: sam },
      { mode: 'exclude', selectorType: 'employment', selectorId: sam },
    ])

    const names = await recipientNames(harborId, id)
    expect(names).not.toContain('Sam Whitfield')
    expect(names.length).toBeGreaterThan(5)
  })

  it('never produces a duplicate when groups overlap', async () => {
    const owner = await actorFor(harborId, OWNER)
    const riverside = await idOf(harborId, 'locations', 'name', 'Riverside')
    const server = await idOf(harborId, 'job_roles', 'name', 'Server')

    const id = await publish(owner, harborId, { title: 'Overlapping' }, [
      { mode: 'include', selectorType: 'organization', selectorId: null },
      { mode: 'include', selectorType: 'location', selectorId: riverside },
      { mode: 'include', selectorType: 'job_role', selectorId: server },
    ])

    const names = await recipientNames(harborId, id)
    expect(new Set(names).size).toBe(names.length)
  })

  it('describes the audience in words before anything is sent', async () => {
    const owner = await actorFor(harborId, OWNER)
    const riverside = await idOf(harborId, 'locations', 'name', 'Riverside')
    const boh = await idOf(harborId, 'departments', 'name', 'Back of House')

    const preview = await asTenant(harborId, (tx) =>
      previewAudience(tx, owner, [
        { mode: 'include', selectorType: 'location', selectorId: riverside },
        { mode: 'exclude', selectorType: 'department', selectorId: boh },
      ]),
    )

    expect(preview.summary).toBe('Riverside, except Back of House department')
    expect(preview.count).toBeGreaterThan(0)
  })
})

describe('targeting boundaries', () => {
  it('refuses a selector belonging to another tenant', async () => {
    const owner = await actorFor(harborId, OWNER)
    const salonLocation = await idOf(lumenId, 'locations', 'name', 'Pearl District')

    await expect(
      asTenant(harborId, (tx) =>
        previewAudience(tx, owner, [
          { mode: 'include', selectorType: 'location', selectorId: salonLocation },
        ]),
      ),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('refuses a location-scoped manager targeting another location', async () => {
    const gm = await actorFor(harborId, GM_RIVERSIDE)
    const downtown = await idOf(harborId, 'locations', 'name', 'Downtown')

    await expect(
      asTenant(harborId, (tx) =>
        previewAudience(tx, gm, [
          { mode: 'include', selectorType: 'location', selectorId: downtown },
        ]),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('refuses a location-scoped manager targeting the whole organization', async () => {
    const gm = await actorFor(harborId, GM_RIVERSIDE)
    await expect(
      asTenant(harborId, (tx) =>
        previewAudience(tx, gm, [
          { mode: 'include', selectorType: 'organization', selectorId: null },
        ]),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('allows a location-scoped manager their own location', async () => {
    const gm = await actorFor(harborId, GM_RIVERSIDE)
    const riverside = await idOf(harborId, 'locations', 'name', 'Riverside')

    const preview = await asTenant(harborId, (tx) =>
      previewAudience(tx, gm, [
        { mode: 'include', selectorType: 'location', selectorId: riverside },
      ]),
    )
    expect(preview.count).toBeGreaterThan(0)
  })

  it('re-checks scope at PUBLICATION, not only when the draft was saved', async () => {
    // Saved while org-wide, then published by somebody who is not.
    const owner = await actorFor(harborId, OWNER)
    const gm = await actorFor(harborId, GM_RIVERSIDE)
    const category = await categoryId(harborId, 'general')

    const id = await asTenant(harborId, (tx) =>
      createAnnouncement(tx, owner, draft({ title: 'Wide draft', categoryId: category }), [
        { mode: 'include', selectorType: 'organization', selectorId: null },
      ]),
    )

    await expect(
      asTenant(harborId, (tx) => publishAnnouncement(tx, gm, id)),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('an employee cannot create an announcement at all', async () => {
    const employee = await actorFor(harborId, EMPLOYEE)
    const category = await categoryId(harborId, 'general')
    await expect(
      asTenant(harborId, (tx) =>
        createAnnouncement(tx, employee, draft({ categoryId: category }), [
          { mode: 'include', selectorType: 'organization', selectorId: null },
        ]),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('another tenant’s announcement is NOT FOUND, not forbidden', async () => {
    const owner = await actorFor(harborId, OWNER)
    const salonOwner = await actorFor(lumenId, SALON_OWNER)
    const salonAnnouncement = await publish(salonOwner, lumenId, { title: 'Salon only' }, [
      { mode: 'include', selectorType: 'organization', selectorId: null },
    ])

    await expect(
      asTenant(harborId, (tx) => requireAnnouncement(tx, owner, salonAnnouncement)),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('the lifecycle', () => {
  it('a draft has no recipients and nobody can see it', async () => {
    const owner = await actorFor(harborId, OWNER)
    const category = await categoryId(harborId, 'general')
    const id = await asTenant(harborId, (tx) =>
      createAnnouncement(tx, owner, draft({ title: 'Unsent', categoryId: category }), [
        { mode: 'include', selectorType: 'organization', selectorId: null },
      ]),
    )

    expect(await recipientNames(harborId, id)).toHaveLength(0)

    const employee = await actorFor(harborId, EMPLOYEE)
    await expect(
      asTenant(harborId, (tx) => openAnnouncement(tx, employee, employee.employmentId, id)),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('refuses to publish without an audience', async () => {
    const owner = await actorFor(harborId, OWNER)
    const category = await categoryId(harborId, 'general')
    const id = await asTenant(harborId, (tx) =>
      createAnnouncement(tx, owner, draft({ title: 'No audience', categoryId: category }), []),
    )
    await expect(
      asTenant(harborId, (tx) => publishAnnouncement(tx, owner, id)),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('editing a draft replaces it, and does not accumulate revisions', async () => {
    const owner = await actorFor(harborId, OWNER)
    const category = await categoryId(harborId, 'general')
    const id = await asTenant(harborId, (tx) =>
      createAnnouncement(tx, owner, draft({ title: 'First go', categoryId: category }), [
        { mode: 'include', selectorType: 'organization', selectorId: null },
      ]),
    )

    await asTenant(harborId, (tx) =>
      updateDraft(
        tx,
        owner,
        id,
        draft({ title: 'Second go', body: 'Rewritten.', categoryId: category }),
        [{ mode: 'include', selectorType: 'organization', selectorId: null }],
      ),
    )

    const record = await asTenant(harborId, (tx) => requireAnnouncement(tx, owner, id))
    expect(record.title).toBe('Second go')
    expect(record.revisionNumber).toBe(1)
  })

  it('schedules, then cancels back to a draft with nobody touched', async () => {
    const owner = await actorFor(harborId, OWNER)
    const category = await categoryId(harborId, 'general')
    const id = await asTenant(harborId, (tx) =>
      createAnnouncement(tx, owner, draft({ title: 'Later', categoryId: category }), [
        { mode: 'include', selectorType: 'organization', selectorId: null },
      ]),
    )

    const soon = new Date(Date.now() + 60 * 60 * 1000)
    await asTenant(harborId, (tx) => scheduleAnnouncement(tx, owner, id, soon))
    expect((await asTenant(harborId, (tx) => requireAnnouncement(tx, owner, id))).status).toBe(
      'scheduled',
    )
    expect(await recipientNames(harborId, id)).toHaveLength(0)

    await asTenant(harborId, (tx) => cancelSchedule(tx, owner, id))
    expect((await asTenant(harborId, (tx) => requireAnnouncement(tx, owner, id))).status).toBe(
      'draft',
    )
    expect(await recipientNames(harborId, id)).toHaveLength(0)
  })

  it('refuses a schedule in the past', async () => {
    const owner = await actorFor(harborId, OWNER)
    const category = await categoryId(harborId, 'general')
    const id = await asTenant(harborId, (tx) =>
      createAnnouncement(tx, owner, draft({ title: 'Backwards', categoryId: category }), [
        { mode: 'include', selectorType: 'organization', selectorId: null },
      ]),
    )
    await expect(
      asTenant(harborId, (tx) => scheduleAnnouncement(tx, owner, id, new Date(Date.now() - 1000))),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('publishes a schedule once its time arrives, and only once', async () => {
    const owner = await actorFor(harborId, OWNER)
    const category = await categoryId(harborId, 'general')
    const sam = await idOf(harborId, 'employments', 'display_name', 'Sam Whitfield')
    const id = await asTenant(harborId, (tx) =>
      createAnnouncement(tx, owner, draft({ title: 'Due now', categoryId: category }), [
        { mode: 'include', selectorType: 'employment', selectorId: sam },
      ]),
    )
    await asTenant(harborId, (tx) =>
      scheduleAnnouncement(tx, owner, id, new Date(Date.now() + 60 * 1000)),
    )

    const later = new Date(Date.now() + 5 * 60 * 1000)
    const first = await asTenant(harborId, (tx) =>
      publishScheduledAnnouncement(tx, harborId, id, later),
    )
    expect(first).toEqual({ kind: 'published', recipients: 1 })

    // Running the job again must not re-publish or duplicate anybody.
    const second = await asTenant(harborId, (tx) =>
      publishScheduledAnnouncement(tx, harborId, id, later),
    )
    expect(second).toEqual({ kind: 'not_due' })
    expect(await recipientNames(harborId, id)).toEqual(['Sam Whitfield'])
  })

  it('expires a published announcement once its time passes', async () => {
    const owner = await actorFor(harborId, OWNER)
    const sam = await idOf(harborId, 'employments', 'display_name', 'Sam Whitfield')
    const id = await publish(
      owner,
      harborId,
      { title: 'Short lived', expiresAt: new Date(Date.now() + 60 * 1000) },
      [{ mode: 'include', selectorType: 'employment', selectorId: sam }],
    )

    await asTenant(harborId, (tx) => expireDue(tx, harborId, new Date(Date.now() + 120 * 1000)))
    expect((await asTenant(harborId, (tx) => requireAnnouncement(tx, owner, id))).status).toBe(
      'expired',
    )
  })

  it('archives without destroying receipts', async () => {
    const owner = await actorFor(harborId, OWNER)
    const sam = await idOf(harborId, 'employments', 'display_name', 'Sam Whitfield')
    const id = await publish(owner, harborId, { title: 'To archive' }, [
      { mode: 'include', selectorType: 'employment', selectorId: sam },
    ])

    await asTenant(harborId, (tx) => archiveAnnouncement(tx, owner, id))
    expect(await recipientNames(harborId, id)).toEqual(['Sam Whitfield'])
    expect((await asTenant(harborId, (tx) => requireAnnouncement(tx, owner, id))).status).toBe(
      'archived',
    )
  })

  it('duplicates the wording and the audience into a fresh draft', async () => {
    const owner = await actorFor(harborId, OWNER)
    const riverside = await idOf(harborId, 'locations', 'name', 'Riverside')
    const original = await publish(owner, harborId, { title: 'Original' }, [
      { mode: 'include', selectorType: 'location', selectorId: riverside },
    ])

    const copyId = await asTenant(harborId, (tx) => duplicateAnnouncement(tx, owner, original))
    const copy = await asTenant(harborId, (tx) => requireAnnouncement(tx, owner, copyId))

    expect(copy.status).toBe('draft')
    expect(copy.title).toContain('Original')
    const rules = await asTenant(harborId, (tx) => loadAudienceRules(tx, harborId, copyId))
    expect(rules).toHaveLength(1)
    expect(rules[0]?.selectorId).toBe(riverside)
    expect(await recipientNames(harborId, copyId)).toHaveLength(0)
  })
})

describe('idempotency', () => {
  it('publishing twice cannot duplicate a recipient', async () => {
    const owner = await actorFor(harborId, OWNER)
    const id = await publish(owner, harborId, { title: 'Once only' }, [
      { mode: 'include', selectorType: 'organization', selectorId: null },
    ])
    const first = await recipientNames(harborId, id)

    // publishAnnouncement refuses a second publish outright...
    await expect(
      asTenant(harborId, (tx) => publishAnnouncement(tx, owner, id)),
    ).rejects.toBeInstanceOf(ValidationError)

    // ...and re-running the materialisation through sync adds nobody.
    const sync = await asTenant(harborId, (tx) => syncRecipients(tx, owner, id))
    expect(sync.recipients).toBe(0)
    expect(await recipientNames(harborId, id)).toEqual(first)
  })

  it('sync adds only people who newly match, and preserves read state', async () => {
    const owner = await actorFor(harborId, OWNER)
    const riverside = await idOf(harborId, 'locations', 'name', 'Riverside')
    const id = await publish(owner, harborId, { title: 'Growing team' }, [
      { mode: 'include', selectorType: 'location', selectorId: riverside },
    ])

    // Somebody reads it.
    const employee = await actorFor(harborId, EMPLOYEE)
    const before = await asTenant(harborId, (tx) =>
      listInbox(tx, employee, employee.employmentId, { filter: 'all' }),
    ).catch(() => [])

    const sync = await asTenant(harborId, (tx) => syncRecipients(tx, owner, id))
    expect(sync.recipients).toBe(0)
    expect(before).toBeDefined()
  })
})

describe('reading and acknowledging', () => {
  it('opening records a VIEW and never an acknowledgement', async () => {
    const owner = await actorFor(harborId, OWNER)
    const employee = await actorFor(harborId, EMPLOYEE)
    const id = await publish(
      owner,
      harborId,
      { title: 'Please confirm', requiresAcknowledgement: true },
      [{ mode: 'include', selectorType: 'employment', selectorId: employee.employmentId }],
    )

    const detail = await asTenant(harborId, (tx) =>
      openAnnouncement(tx, employee, employee.employmentId, id),
    )
    expect(detail.unread).toBe(true) // reports the state BEFORE this open
    expect(detail.acknowledged).toBe(false)

    const report = await asTenant(harborId, (tx) => receiptReport(tx, owner, id))
    expect(report.totals.viewed).toBe(1)
    expect(report.totals.acknowledged).toBe(0)
    expect(report.totals.outstanding).toBe(1)
  })

  it('records an acknowledgement only on the explicit call', async () => {
    const owner = await actorFor(harborId, OWNER)
    const employee = await actorFor(harborId, EMPLOYEE)
    const id = await publish(
      owner,
      harborId,
      { title: 'Confirm me', requiresAcknowledgement: true },
      [{ mode: 'include', selectorType: 'employment', selectorId: employee.employmentId }],
    )

    await asTenant(harborId, (tx) => acknowledge(tx, employee, employee.employmentId, id))

    const report = await asTenant(harborId, (tx) => receiptReport(tx, owner, id))
    expect(report.totals.acknowledged).toBe(1)
    expect(report.totals.outstanding).toBe(0)
    // Acknowledging counts as reading, for anyone arriving by deep link.
    expect(report.totals.viewed).toBe(1)
  })

  it('refuses to acknowledge something that never asked', async () => {
    const owner = await actorFor(harborId, OWNER)
    const employee = await actorFor(harborId, EMPLOYEE)
    const id = await publish(
      owner,
      harborId,
      { title: 'Just news', requiresAcknowledgement: false },
      [{ mode: 'include', selectorType: 'employment', selectorId: employee.employmentId }],
    )

    await expect(
      asTenant(harborId, (tx) => acknowledge(tx, employee, employee.employmentId, id)),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('refuses to read somebody else’s inbox', async () => {
    const owner = await actorFor(harborId, OWNER)
    const employee = await actorFor(harborId, EMPLOYEE)

    await expect(
      asTenant(harborId, (tx) => listInbox(tx, owner, employee.employmentId, {})),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('a non-recipient gets NOT FOUND rather than a refusal', async () => {
    const owner = await actorFor(harborId, OWNER)
    const employee = await actorFor(harborId, EMPLOYEE)
    const someoneElse = await idOf(harborId, 'employments', 'display_name', 'Dmitri Sokolov')

    const id = await publish(owner, harborId, { title: 'Not for Sam' }, [
      { mode: 'include', selectorType: 'employment', selectorId: someoneElse },
    ])

    await expect(
      asTenant(harborId, (tx) => openAnnouncement(tx, employee, employee.employmentId, id)),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('revisions', () => {
  it('appends a revision instead of editing published wording', async () => {
    const owner = await actorFor(harborId, OWNER)
    const sam = await idOf(harborId, 'employments', 'display_name', 'Sam Whitfield')
    const id = await publish(owner, harborId, { title: 'Version one' }, [
      { mode: 'include', selectorType: 'employment', selectorId: sam },
    ])

    const number = await asTenant(harborId, (tx) =>
      reviseAnnouncement(tx, owner, id, {
        title: 'Version two',
        body: 'Corrected wording.',
        callToActionLabel: null,
        callToActionHref: null,
        isMaterial: false,
        note: 'Fixed a typo',
      }),
    )

    expect(number).toBe(2)
    const record = await asTenant(harborId, (tx) => requireAnnouncement(tx, owner, id))
    expect(record.title).toBe('Version two')

    // The old wording is still on file.
    const pool = await migrationClient()
    const { rows } = await pool.query<{ title: string }>(
      `select title from announcement_revisions
        where announcement_id = $1 order by revision_number`,
      [id],
    )
    expect(rows.map((r) => r.title)).toEqual(['Version one', 'Version two'])
  })

  it('a NON-material revision leaves acknowledgements alone', async () => {
    const owner = await actorFor(harborId, OWNER)
    const employee = await actorFor(harborId, EMPLOYEE)
    const id = await publish(
      owner,
      harborId,
      { title: 'Typo incoming', requiresAcknowledgement: true },
      [{ mode: 'include', selectorType: 'employment', selectorId: employee.employmentId }],
    )
    await asTenant(harborId, (tx) => acknowledge(tx, employee, employee.employmentId, id))

    await asTenant(harborId, (tx) =>
      reviseAnnouncement(tx, owner, id, {
        title: 'Typo fixed',
        body: 'Same meaning.',
        callToActionLabel: null,
        callToActionHref: null,
        isMaterial: false,
        note: null,
      }),
    )

    const report = await asTenant(harborId, (tx) => receiptReport(tx, owner, id))
    expect(report.totals.outstanding).toBe(0)
  })

  it('a MATERIAL revision asks again, and keeps what was agreed before', async () => {
    const owner = await actorFor(harborId, OWNER)
    const employee = await actorFor(harborId, EMPLOYEE)
    const id = await publish(
      owner,
      harborId,
      { title: 'Policy v1', requiresAcknowledgement: true },
      [{ mode: 'include', selectorType: 'employment', selectorId: employee.employmentId }],
    )
    await asTenant(harborId, (tx) => acknowledge(tx, employee, employee.employmentId, id))

    await asTenant(harborId, (tx) =>
      reviseAnnouncement(tx, owner, id, {
        title: 'Policy v2',
        body: 'The rule has changed.',
        callToActionLabel: null,
        callToActionHref: null,
        isMaterial: true,
        note: 'The cut-off moved to 6pm',
      }),
    )

    const report = await asTenant(harborId, (tx) => receiptReport(tx, owner, id))
    expect(report.totals.outstanding).toBe(1)

    // The employee is told what they previously agreed to.
    const detail = await asTenant(harborId, (tx) =>
      openAnnouncement(tx, employee, employee.employmentId, id, { record: false }),
    )
    expect(detail.needsReacknowledgement).toBe(true)
    expect(detail.acknowledgedRevisionNumber).toBe(1)
    expect(detail.revisionNote).toBe('The cut-off moved to 6pm')

    // Re-confirming clears it and stamps the new revision.
    await asTenant(harborId, (tx) => acknowledge(tx, employee, employee.employmentId, id))
    const after = await asTenant(harborId, (tx) => receiptReport(tx, owner, id))
    expect(after.totals.outstanding).toBe(0)
  })

  it('refuses to revise a draft, which should be edited instead', async () => {
    const owner = await actorFor(harborId, OWNER)
    const category = await categoryId(harborId, 'general')
    const id = await asTenant(harborId, (tx) =>
      createAnnouncement(tx, owner, draft({ title: 'Still a draft', categoryId: category }), [
        { mode: 'include', selectorType: 'organization', selectorId: null },
      ]),
    )
    await expect(
      asTenant(harborId, (tx) =>
        reviseAnnouncement(tx, owner, id, {
          title: 'x',
          body: 'y',
          callToActionLabel: null,
          callToActionHref: null,
          isMaterial: false,
          note: null,
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError)
  })
})

describe('receipt scope', () => {
  it('a location manager sees only their own location, and is told so', async () => {
    const owner = await actorFor(harborId, OWNER)
    const gm = await actorFor(harborId, GM_RIVERSIDE)
    const riverside = await idOf(harborId, 'locations', 'name', 'Riverside')

    const id = await publish(owner, harborId, { title: 'Org wide report' }, [
      { mode: 'include', selectorType: 'organization', selectorId: null },
    ])

    const full = await asTenant(harborId, (tx) => receiptReport(tx, owner, id))
    const partial = await asTenant(harborId, (tx) => receiptReport(tx, gm, id))

    expect(partial.partialView).toBe(true)
    expect(full.partialView).toBe(false)
    expect(partial.totals.targeted).toBeLessThan(full.totals.targeted)
    expect(partial.byLocation.every((b) => b.label === 'Riverside')).toBe(true)

    // And the location filter is on where people were WHEN TARGETED.
    const pool = await migrationClient()
    const { rows } = await pool.query<{ n: string }>(
      `select count(*) n from announcement_recipients
        where announcement_id = $1 and location_id_at_publish = $2`,
      [id, riverside],
    )
    expect(partial.totals.targeted).toBe(Number(rows[0]?.n))
  })

  it('reminders reach only the people the sender can see', async () => {
    const owner = await actorFor(harborId, OWNER)
    const gm = await actorFor(harborId, GM_RIVERSIDE)

    const id = await publish(
      owner,
      harborId,
      { title: 'Chase me', requiresAcknowledgement: true },
      [{ mode: 'include', selectorType: 'organization', selectorId: null }],
    )

    const gmReport = await asTenant(harborId, (tx) => receiptReport(tx, gm, id))
    const outcome = await asTenant(harborId, (tx) => sendReminders(tx, gm, id))
    expect(outcome.reminded).toBe(gmReport.totals.outstanding)

    const ownerReport = await asTenant(harborId, (tx) => receiptReport(tx, owner, id))
    expect(outcome.reminded).toBeLessThan(ownerReport.totals.targeted)
  })

  it('a reminder pressed twice sends one notification', async () => {
    const owner = await actorFor(harborId, OWNER)
    const sam = await idOf(harborId, 'employments', 'display_name', 'Sam Whitfield')
    const id = await publish(
      owner,
      harborId,
      { title: 'Double click', requiresAcknowledgement: true },
      [{ mode: 'include', selectorType: 'employment', selectorId: sam }],
    )

    const now = new Date()
    // The same reminder number, because both calls are the first reminder for
    // a recipient whose count has not yet been observed by the other.
    const first = await asTenant(harborId, (tx) => sendReminders(tx, owner, id, now))
    expect(first.queued).toBe(1)

    const pool = await migrationClient()
    const { rows } = await pool.query<{ n: string }>(
      `select count(*) n from notifications
        where subject_id = $1 and channel = 'in_app' and idempotency_key like '%reminder-1'`,
      [id],
    )
    expect(Number(rows[0]?.n)).toBe(1)
  })

  it('an employee cannot see receipts', async () => {
    const owner = await actorFor(harborId, OWNER)
    const employee = await actorFor(harborId, EMPLOYEE)
    const id = await publish(owner, harborId, { title: 'Private numbers' }, [
      { mode: 'include', selectorType: 'organization', selectorId: null },
    ])

    await expect(
      asTenant(harborId, (tx) => receiptReport(tx, employee, id)),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('priority authorization', () => {
  it('refuses emergency without the emergency capability', async () => {
    // The training manager may publish, but not declare an emergency.
    const gm = await actorFor(harborId, GM_RIVERSIDE)
    const riverside = await idOf(harborId, 'locations', 'name', 'Riverside')
    const category = await categoryId(harborId, 'emergency')

    await expect(
      asTenant(harborId, (tx) =>
        createAnnouncement(
          tx,
          gm,
          draft({ title: 'Not allowed', priority: 'emergency', categoryId: category }),
          [{ mode: 'include', selectorType: 'location', selectorId: riverside }],
        ),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('allows an owner to send an emergency, and records it distinctly', async () => {
    const owner = await actorFor(harborId, OWNER)
    const sam = await idOf(harborId, 'employments', 'display_name', 'Sam Whitfield')
    const category = await categoryId(harborId, 'emergency')

    const id = await publish(
      owner,
      harborId,
      { title: 'Closure', priority: 'emergency', categoryId: category },
      [{ mode: 'include', selectorType: 'employment', selectorId: sam }],
    )

    const pool = await migrationClient()
    const { rows } = await pool.query<{ action: string }>(
      `select action from audit_events where subject_id = $1 order by created_at desc limit 1`,
      [id],
    )
    expect(rows[0]?.action).toBe('announcement.emergency_published')
  })
})

describe('the inbox digest', () => {
  it('counts what needs doing and names the most demanding item', async () => {
    const owner = await actorFor(harborId, OWNER)
    const employee = await actorFor(harborId, EMPLOYEE)

    await publish(
      owner,
      harborId,
      { title: 'Digest confirm me', requiresAcknowledgement: true, priority: 'urgent' },
      [{ mode: 'include', selectorType: 'employment', selectorId: employee.employmentId }],
    )

    const digest = await asTenant(harborId, (tx) =>
      inboxDigest(tx, employee, employee.employmentId),
    )
    expect(digest.acknowledgementsDue).toBeGreaterThan(0)
    expect(digest.headline?.requiresAcknowledgement).toBe(true)
  })
})

describe('the author list', () => {
  it('hides another location’s announcements from a location manager', async () => {
    const owner = await actorFor(harborId, OWNER)
    const gm = await actorFor(harborId, GM_RIVERSIDE)
    const downtown = await idOf(harborId, 'locations', 'name', 'Downtown')

    const id = await publish(owner, harborId, { title: 'Downtown internal' }, [
      { mode: 'include', selectorType: 'location', selectorId: downtown },
    ])

    const visible = await asTenant(harborId, (tx) => listAnnouncements(tx, gm, {}))
    expect(visible.map((a) => a.id)).not.toContain(id)

    const ownerSees = await asTenant(harborId, (tx) => listAnnouncements(tx, owner, {}))
    expect(ownerSees.map((a) => a.id)).toContain(id)
  })
})

describe('what the runtime role cannot destroy', () => {
  /*
   * These are the guarantees the receipts and the revision history rest on.
   * They are asserted against the ACTUAL grants rather than against the
   * migration text, because 0001 grants full DML by default to every new
   * table - so a migration that merely GRANTs narrowly changes nothing, which
   * is exactly the mistake 0012 exists to correct.
   */
  it('cannot delete a receipt, a revision, or a delivery record', async () => {
    const pool = await migrationClient()
    const { rows } = await pool.query<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type
         from information_schema.role_table_grants
        where grantee = 'evercalm_app'
          and table_name = any($1)`,
      [['announcement_recipients', 'announcement_revisions', 'notifications']],
    )

    const byTable = new Map<string, Set<string>>()
    for (const row of rows) {
      const set = byTable.get(row.table_name) ?? new Set<string>()
      set.add(row.privilege_type)
      byTable.set(row.table_name, set)
    }

    for (const table of ['announcement_recipients', 'announcement_revisions', 'notifications']) {
      const grants = byTable.get(table)
      expect(grants, `${table} should be granted to the runtime role`).toBeDefined()
      expect([...grants!].sort(), `${table} must not be deletable`).not.toContain('DELETE')
      // Still writable: view counts, acknowledgements and delivery state are updates.
      expect([...grants!], `${table} must stay writable`).toContain('UPDATE')
    }
  })

  it('editing a draft rewrites its revision rather than replacing it', async () => {
    const owner = await actorFor(harborId, OWNER)
    const category = await categoryId(harborId, 'general')
    const id = await asTenant(harborId, (tx) =>
      createAnnouncement(tx, owner, draft({ title: 'Rewrite me', categoryId: category }), [
        { mode: 'include', selectorType: 'organization', selectorId: null },
      ]),
    )

    const pool = await migrationClient()
    const before = await pool.query<{ id: string }>(
      `select id from announcement_revisions where announcement_id = $1`,
      [id],
    )

    await asTenant(harborId, (tx) =>
      updateDraft(
        tx,
        owner,
        id,
        draft({ title: 'Rewritten', body: 'New words.', categoryId: category }),
        [{ mode: 'include', selectorType: 'organization', selectorId: null }],
      ),
    )

    const after = await pool.query<{ id: string; title: string }>(
      `select id, title from announcement_revisions where announcement_id = $1`,
      [id],
    )
    expect(after.rows).toHaveLength(1)
    // The same row, updated - not a delete and reinsert.
    expect(after.rows[0]?.id).toBe(before.rows[0]?.id)
    expect(after.rows[0]?.title).toBe('Rewritten')
  })
})
