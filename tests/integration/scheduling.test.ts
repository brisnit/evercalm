import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { addCalendarDays } from '@/lib/dates'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { resolveActor } from '@/server/authz/resolve'
import type { Actor } from '@/server/authz/actor'
import {
  applyTemplates,
  assignShift,
  cancelShift,
  createShift,
  createTemplate,
  loadWeek,
  previewPublication,
  publishSchedule,
  setShiftOpen,
  updateShift,
} from '@/modules/scheduling/service'
import {
  claimOpenShift,
  decideClaim,
  decideSwap,
  decideTimeOff,
  getAvailability,
  listTimeOffForReview,
  replaceWeeklyAvailability,
  requestSwap,
  requestTimeOff,
  respondToSwap,
} from '@/modules/scheduling/requests'
import { getMySchedule, getMyShift } from '@/modules/scheduling/employee'
import {
  isoWeekday,
  localDateOf,
  parseTimeOfDay,
  weekDates,
  weekStartOf,
} from '@/modules/scheduling/time'
import {
  asTenant,
  closeTestPools,
  migrationClient,
  organizationIdBySlug,
  rawAsApp,
} from '../helpers/tenant'

/**
 * SCHEDULING, END TO END, against real PostgreSQL.
 *
 * The promises under test:
 *
 *   a manager reaches exactly their own locations, and another tenant not at all
 *   times are stored as the clock times the manager meant, where the work is
 *   nobody is put on a shift they cannot work - approved time off, overlap,
 *     the wrong location - and the database refuses a double booking even if
 *     the service were bypassed
 *   employees see only what was published, and a republication tells exactly
 *     the people whose shifts changed
 *   concurrent approvals of claims and swaps cannot both win
 *
 * Every test works in its own future week (well clear of the seeded weeks and
 * of each other), so tests never collide on the same person at the same time.
 */

const LA = 'America/Los_Angeles'
const H = (hhmm: string) => parseTimeOfDay(hhmm)!

let harborId: string
let lumenId: string
const users = new Map<string, string>()

beforeAll(async () => {
  harborId = await organizationIdBySlug('harbor-vine')
  lumenId = await organizationIdBySlug('lumen-salon')
  const pool = await migrationClient()
  const rows = await pool.query<{ id: string; email: string }>('select id, email from "user"')
  for (const row of rows.rows) users.set(row.email, row.id)
})

afterAll(async () => {
  await closeTestPools()
})

// --- helpers ------------------------------------------------------------------

async function actor(organizationId: string, email: string): Promise<Actor> {
  const userId = users.get(email)!
  const resolved = await asTenant(organizationId, (tx) => resolveActor(tx, organizationId, userId))
  if (!resolved) throw new Error(`No actor for ${email}`)
  return resolved
}

const harbor = {
  owner: () => actor(harborId, 'dana@harborvine.test'),
  hr: () => actor(harborId, 'priya@harborvine.test'),
  gmRiverside: () => actor(harborId, 'marcus@harborvine.test'),
  gmDowntown: () => actor(harborId, 'tess@harborvine.test'),
  scheduler: () => actor(harborId, 'omar@harborvine.test'),
  lead: () => actor(harborId, 'jordan@harborvine.test'),
  sam: () => actor(harborId, 'sam@harborvine.test'),
  camille: () => actor(harborId, 'camille@harborvine.test'),
  ava: () => actor(harborId, 'ava@harborvine.test'),
  theo: () => actor(harborId, 'theo@harborvine.test'),
}

async function idWhere(table: string, organizationId: string, column: string, value: string) {
  const pool = await migrationClient()
  const { rows } = await pool.query<{ id: string }>(
    `select id from ${table} where organization_id = $1 and ${column} = $2 limit 1`,
    [organizationId, value],
  )
  if (!rows[0]) throw new Error(`No ${table}.${column} = ${value}`)
  return rows[0].id
}

const location = (org: string, name: string) => idWhere('locations', org, 'name', name)
const jobRole = (org: string, name: string) => idWhere('job_roles', org, 'name', name)

/** A local date `weeks` weeks from now at a location, on an ISO weekday. */
function dateIn(weeks: number, weekday: number, timeZone = LA): string {
  const start = addCalendarDays(weekStartOf(localDateOf(new Date(), timeZone)), 7 * weeks)
  return weekDates(start).find((d) => isoWeekday(d) === weekday)!
}

function weekOf(date: string) {
  return weekStartOf(date)
}

async function query<T extends Record<string, unknown>>(sql: string, params: unknown[] = []) {
  const pool = await migrationClient()
  return (await pool.query<T>(sql, params)).rows
}

async function shiftRow(id: string) {
  const [row] = await query<{
    assignee_employment_id: string | null
    published_assignee_employment_id: string | null
    starts_at: Date
    ends_at: Date
    published_starts_at: Date | null
    status: string
    published_status: string | null
    is_open: boolean
    version: number
  }>('select * from shifts where id = $1', [id])
  return row
}

async function notificationsFor(subjectId: string) {
  return query<{ employment_id: string; purpose: string; channel: string; title: string }>(
    `select employment_id, split_part(idempotency_key, ':', 5) as purpose, channel, title
       from notifications where subject_id = $1 order by created_at`,
    [subjectId],
  )
}

async function auditCount(subjectId: string, action: string) {
  const [row] = await query<{ n: string }>(
    'select count(*) as n from audit_events where subject_id = $1 and action = $2',
    [subjectId, action],
  )
  return Number(row!.n)
}

/** Create and assign a shift, returning its id and schedule id. */
async function makeShift(
  manager: Actor,
  locationId: string,
  date: string,
  start: string,
  end: string,
  assignee: string | null,
  extra: { jobRoleId?: string | null; breakMinutes?: number } = {},
) {
  const result = await asTenant(harborId, (tx) =>
    createShift(tx, manager, locationId, {
      date,
      startMinute: H(start),
      endMinute: H(end),
      breakMinutes: extra.breakMinutes ?? 0,
      jobRoleId: extra.jobRoleId ?? null,
      stationId: null,
      notes: '',
      assigneeEmploymentId: assignee,
    }),
  )
  const board = await asTenant(harborId, (tx) => loadWeek(tx, manager, locationId, weekOf(date)))
  return { shiftId: result.id, scheduleId: board.schedule!.id, warnings: result.warnings }
}

const publish = (manager: Actor, scheduleId: string) =>
  asTenant(harborId, (tx) => publishSchedule(tx, manager, scheduleId))

// ---------------------------------------------------------------------------

describe('who can reach which schedule', () => {
  it('lets a location manager work their own location and nothing else', async () => {
    const riverside = await location(harborId, 'Riverside')
    const downtown = await location(harborId, 'Downtown')
    const gm = await harbor.gmRiverside()
    const week = weekOf(dateIn(3, 2))

    await expect(
      asTenant(harborId, (tx) => loadWeek(tx, gm, riverside, week)),
    ).resolves.toBeTruthy()
    // Another location in the same organization reads as not found, not forbidden.
    await expect(
      asTenant(harborId, (tx) => loadWeek(tx, gm, downtown, week)),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      makeShift(gm, downtown, dateIn(3, 3), '09:00', '17:00', null),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('keeps people with no scheduling capability out entirely', async () => {
    const riverside = await location(harborId, 'Riverside')
    const week = weekOf(dateIn(3, 2))
    for (const person of [await harbor.sam(), await harbor.lead()]) {
      await expect(
        asTenant(harborId, (tx) => loadWeek(tx, person, riverside, week)),
      ).rejects.toBeInstanceOf(NotFoundError)
    }
  })

  it('tells someone who can decide time off, but not build schedules, that they lack permission', async () => {
    const riverside = await location(harborId, 'Riverside')
    const hr = await harbor.hr()
    await expect(
      asTenant(harborId, (tx) => loadWeek(tx, hr, riverside, weekOf(dateIn(3, 2)))),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('lets a scheduler build but refuses nobody else’s tenant', async () => {
    const riverside = await location(harborId, 'Riverside')
    const lumenOwner = await actor(lumenId, 'ana@lumensalon.test')
    // Another tenant's location id, asked for inside the salon's own tenant: not found.
    await expect(
      asTenant(lumenId, (tx) => loadWeek(tx, lumenOwner, riverside, weekOf(dateIn(3, 2)))),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('isolates scheduling rows at the database, whatever the application does', async () => {
    const seen = await rawAsApp(
      lumenId,
      `select count(*)::int as n from shifts where organization_id = $1`,
      [harborId],
    )
    expect(seen.rows[0].n).toBe(0)
    const all = await rawAsApp(null, `select count(*)::int as n from time_off_requests`)
    expect(all.rows[0].n).toBe(0)

    const [schedule] = await query<{ id: string; location_id: string }>(
      'select id, location_id from schedules where organization_id = $1 limit 1',
      [harborId],
    )
    await expect(
      rawAsApp(
        lumenId,
        `insert into shifts (id, organization_id, schedule_id, location_id, starts_at, ends_at)
         values (gen_random_uuid(), $1, $2, $3, now() + interval '30 days', now() + interval '30 days 4 hours')`,
        [harborId, schedule!.id, schedule!.location_id],
      ),
    ).rejects.toThrow(/row-level security/)
  })

  it('removes DELETE from decision records at the database', async () => {
    await expect(rawAsApp(harborId, 'delete from time_off_requests')).rejects.toThrow(
      /permission denied/,
    )
    await expect(rawAsApp(harborId, 'delete from shift_swap_requests')).rejects.toThrow(
      /permission denied/,
    )
    await expect(rawAsApp(harborId, 'delete from schedules')).rejects.toThrow(/permission denied/)
  })
})

describe('time and templates', () => {
  it('stores the clock times meant at the location, including a site in another timezone', async () => {
    const riverside = await location(harborId, 'Riverside')
    const gm = await harbor.gmRiverside()
    const date = dateIn(3, 3)
    const { shiftId } = await makeShift(gm, riverside, date, '16:00', '22:30', null)
    const row = await shiftRow(shiftId)
    expect(localDateOf(row!.starts_at, LA)).toBe(date)
    expect(
      new Intl.DateTimeFormat('en-US', { timeZone: LA, hour: 'numeric', minute: '2-digit' }).format(
        row!.starts_at,
      ),
    ).toBe('4:00 PM')

    const bench = await location(lumenId, 'Boise Bench')
    const salonGm = await actor(lumenId, 'sierra@lumensalon.test')
    const denverDate = dateIn(3, 3, 'America/Denver')
    const created = await asTenant(lumenId, (tx) =>
      createShift(tx, salonGm, bench, {
        date: denverDate,
        startMinute: H('09:00'),
        endMinute: H('17:00'),
        breakMinutes: 30,
        jobRoleId: null,
        stationId: null,
        notes: '',
        assigneeEmploymentId: null,
      }),
    )
    const [salonShift] = await query<{ starts_at: Date }>(
      'select starts_at from shifts where id = $1',
      [created.id],
    )
    expect(
      new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', hour: 'numeric' }).format(
        salonShift!.starts_at,
      ),
    ).toBe('9 AM')
  })

  it('stores the real length of a shift on the night the clocks fall back', async () => {
    const riverside = await location(harborId, 'Riverside')
    const gm = await harbor.gmRiverside()
    const { shiftId } = await makeShift(gm, riverside, '2026-11-01', '00:00', '08:00', null)
    const row = await shiftRow(shiftId)
    expect((row!.ends_at.getTime() - row!.starts_at.getTime()) / 3_600_000).toBe(9)
  })

  it('refuses a clock time that does not exist', async () => {
    const riverside = await location(harborId, 'Riverside')
    const gm = await harbor.gmRiverside()
    await expect(
      makeShift(gm, riverside, '2027-03-14', '02:30', '09:00', null),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('applies templates to a week once, however many times it is asked', async () => {
    const riverside = await location(harborId, 'Riverside')
    const scheduler = await harbor.scheduler()
    const serverRole = await jobRole(harborId, 'Server')
    const templateId = await asTenant(harborId, (tx) =>
      createTemplate(tx, scheduler, riverside, {
        name: `Brunch ${Date.now()}`,
        jobRoleId: serverRole,
        stationId: null,
        startMinute: H('09:00'),
        endMinute: H('14:00'),
        breakMinutes: 0,
        daysOfWeek: [6, 7],
        headcount: 2,
        notes: '',
      }),
    )
    const week = weekOf(dateIn(4, 1))
    const first = await asTenant(harborId, (tx) =>
      applyTemplates(tx, scheduler, riverside, week, [templateId]),
    )
    const second = await asTenant(harborId, (tx) =>
      applyTemplates(tx, scheduler, riverside, week, [templateId]),
    )
    expect(first.created).toBe(4)
    expect(second.created).toBe(0)
  })
})

describe('who can be put on a shift', () => {
  it('refuses someone on approved time off, and warns about pending time off', async () => {
    const riverside = await location(harborId, 'Riverside')
    const gm = await harbor.gmRiverside()
    const camille = await harbor.camille()
    const date = dateIn(5, 4)

    const requestId = await asTenant(harborId, (tx) =>
      requestTimeOff(tx, camille, {
        startsOn: date,
        endsOn: date,
        startMinute: null,
        endMinute: null,
        reason: 'vacation',
        note: '',
      }),
    )
    const pending = await makeShift(gm, riverside, date, '17:00', '23:00', camille.employmentId)
    expect(pending.warnings.join(' ')).toMatch(/asked for time off/)
    await asTenant(harborId, (tx) => assignShift(tx, gm, pending.shiftId, null))

    await asTenant(harborId, (tx) => decideTimeOff(tx, gm, requestId, 'approved', ''))
    await expect(
      makeShift(gm, riverside, date, '09:00', '12:00', camille.employmentId),
    ).rejects.toThrow(/approved time off/)
  })

  it('refuses an overlapping assignment and someone from another location', async () => {
    const riverside = await location(harborId, 'Riverside')
    const gm = await harbor.gmRiverside()
    const sam = await harbor.sam()
    const theo = await harbor.theo()
    const date = dateIn(5, 5)
    await makeShift(gm, riverside, date, '16:00', '22:00', sam.employmentId)
    await expect(
      makeShift(gm, riverside, date, '21:00', '23:30', sam.employmentId),
    ).rejects.toThrow(/overlaps/)
    await expect(
      makeShift(gm, riverside, date, '10:00', '14:00', theo.employmentId),
    ).rejects.toThrow(/not assigned to work at this location/)
  })

  it('refuses a double booking at the database even if the service is bypassed', async () => {
    const riverside = await location(harborId, 'Riverside')
    const gm = await harbor.gmRiverside()
    const sam = await harbor.sam()
    const date = dateIn(5, 6)
    const { scheduleId, shiftId } = await makeShift(
      gm,
      riverside,
      date,
      '10:00',
      '15:00',
      sam.employmentId,
    )
    const existing = await shiftRow(shiftId)
    await expect(
      rawAsApp(
        harborId,
        `insert into shifts (id, organization_id, schedule_id, location_id, starts_at, ends_at, assignee_employment_id)
         values (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
        [
          harborId,
          scheduleId,
          riverside,
          new Date(existing!.starts_at.getTime() + 3_600_000),
          new Date(existing!.ends_at.getTime() + 3_600_000),
          sam.employmentId,
        ],
      ),
    ).rejects.toThrow(/shifts_no_double_booking/)
  })

  it('warns about declared unavailability, which only the person themselves can change', async () => {
    const riverside = await location(harborId, 'Riverside')
    const gm = await harbor.gmRiverside()
    const gmDowntown = await harbor.gmDowntown()
    const ava = await harbor.ava()
    const date = dateIn(5, 1) // a Monday

    await asTenant(harborId, (tx) =>
      replaceWeeklyAvailability(tx, ava, ava.employmentId, [
        { weekday: 1, startMinute: 0, endMinute: 1440, preference: 'unavailable' },
      ]),
    )
    const { warnings } = await makeShift(gm, riverside, date, '11:00', '15:00', ava.employmentId)
    expect(warnings.join(' ')).toMatch(/unavailable/)

    await expect(
      asTenant(harborId, (tx) => getAvailability(tx, gm, ava.employmentId)),
    ).resolves.toMatchObject({ rules: [expect.objectContaining({ weekday: 1 })] })
    await expect(
      asTenant(harborId, (tx) => getAvailability(tx, gmDowntown, ava.employmentId)),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      asTenant(harborId, (tx) => replaceWeeklyAvailability(tx, gm, ava.employmentId, [])),
    ).rejects.toBeInstanceOf(ForbiddenError)
    // Put it back for the rest of the suite.
    await asTenant(harborId, (tx) => replaceWeeklyAvailability(tx, ava, ava.employmentId, []))
  })
})

describe('time off decisions', () => {
  it('lets only managers of the person’s location decide, never the person themselves', async () => {
    const scheduler = await harbor.scheduler()
    const gmDowntown = await harbor.gmDowntown()
    const gm = await harbor.gmRiverside()
    const hr = await harbor.hr()
    const date = dateIn(6, 3)

    const own = await asTenant(harborId, (tx) =>
      requestTimeOff(tx, scheduler, {
        startsOn: date,
        endsOn: date,
        startMinute: null,
        endMinute: null,
        reason: 'personal',
        note: '',
      }),
    )
    await expect(
      asTenant(harborId, (tx) => decideTimeOff(tx, scheduler, own, 'approved', '')),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      asTenant(harborId, (tx) => decideTimeOff(tx, gmDowntown, own, 'approved', '')),
    ).rejects.toBeInstanceOf(NotFoundError)

    // Two approvers at once: exactly one decision lands.
    const results = await Promise.allSettled([
      asTenant(harborId, (tx) => decideTimeOff(tx, gm, own, 'approved', '')),
      asTenant(harborId, (tx) => decideTimeOff(tx, hr, own, 'denied', '')),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(
      (await auditCount(own, 'time_off.approved')) + (await auditCount(own, 'time_off.denied')),
    ).toBe(1)

    // HR sees the whole organization's requests; a Downtown manager does not see Riverside's.
    const hrView = await asTenant(harborId, (tx) => listTimeOffForReview(tx, hr))
    const downtownView = await asTenant(harborId, (tx) => listTimeOffForReview(tx, gmDowntown))
    expect(hrView.map((r) => r.id)).toContain(own)
    expect(downtownView.map((r) => r.id)).not.toContain(own)
  })
})

describe('publication', () => {
  it('shows employees nothing until publication, then notifies each person once', async () => {
    const riverside = await location(harborId, 'Riverside')
    const gm = await harbor.gmRiverside()
    const sam = await harbor.sam()
    const ava = await harbor.ava()
    const date = dateIn(7, 3)
    const { shiftId, scheduleId } = await makeShift(
      gm,
      riverside,
      date,
      '16:00',
      '22:00',
      sam.employmentId,
    )
    await makeShift(gm, riverside, date, '10:00', '15:00', ava.employmentId)

    expect(
      (
        await asTenant(harborId, (tx) => getMySchedule(tx, sam, { weekStart: weekOf(date) }))
      ).upcoming.map((s) => s.id),
    ).not.toContain(shiftId)
    await expect(asTenant(harborId, (tx) => getMyShift(tx, sam, shiftId))).rejects.toBeInstanceOf(
      NotFoundError,
    )

    const result = await publish(gm, scheduleId)
    expect(result.version).toBe(1)
    expect(
      (
        await asTenant(harborId, (tx) => getMySchedule(tx, sam, { weekStart: weekOf(date) }))
      ).upcoming.map((s) => s.id),
    ).toContain(shiftId)

    const notices = (await notificationsFor(scheduleId)).filter((n) => n.channel === 'in_app')
    expect(notices.map((n) => n.employment_id).sort()).toEqual(
      [sam.employmentId, ava.employmentId].sort(),
    )
    expect(await auditCount(scheduleId, 'schedule.published')).toBe(1)

    await expect(publish(gm, scheduleId)).rejects.toThrow(/Nothing has changed/)
    // Another person cannot open Sam's shift.
    await expect(asTenant(harborId, (tx) => getMyShift(tx, ava, shiftId))).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })

  it('refuses to publish while an assignment has a blocking conflict', async () => {
    const riverside = await location(harborId, 'Riverside')
    const gm = await harbor.gmRiverside()
    const sam = await harbor.sam()
    const date = dateIn(7, 5)
    const requestId = await asTenant(harborId, (tx) =>
      requestTimeOff(tx, sam, {
        startsOn: date,
        endsOn: date,
        startMinute: null,
        endMinute: null,
        reason: 'family',
        note: '',
      }),
    )
    const { scheduleId } = await makeShift(gm, riverside, date, '16:00', '22:00', sam.employmentId)
    const decision = await asTenant(harborId, (tx) =>
      decideTimeOff(tx, gm, requestId, 'approved', ''),
    )
    expect(decision.affectedShifts).toHaveLength(1)

    const preview = await asTenant(harborId, (tx) => previewPublication(tx, gm, scheduleId))
    expect(preview.blocking.length).toBeGreaterThan(0)
    await expect(publish(gm, scheduleId)).rejects.toThrow(/conflict/)
  })

  it('keeps edits after publication invisible until republished, then tells only the people affected', async () => {
    const riverside = await location(harborId, 'Riverside')
    const gm = await harbor.gmRiverside()
    const sam = await harbor.sam()
    const ava = await harbor.ava()
    const camille = await harbor.camille()
    const date = dateIn(8, 3)
    const samShift = await makeShift(gm, riverside, date, '16:00', '22:00', sam.employmentId)
    const avaShift = await makeShift(gm, riverside, date, '09:00', '14:00', ava.employmentId)
    await publish(gm, samShift.scheduleId)

    // Move Sam's shift an hour later. Sam still sees the published time.
    await asTenant(harborId, (tx) =>
      updateShift(tx, gm, samShift.shiftId, {
        date,
        startMinute: H('17:00'),
        endMinute: H('22:00'),
        breakMinutes: 0,
        jobRoleId: null,
        stationId: null,
        notes: '',
      }),
    )
    const before = await asTenant(harborId, (tx) => getMyShift(tx, sam, samShift.shiftId))
    expect(before.shift.time).toBe('4:00 PM – 10:00 PM')
    const board = await asTenant(harborId, (tx) => loadWeek(tx, gm, riverside, weekOf(date)))
    expect(board.schedule!.hasUnpublishedChanges).toBe(true)

    const v2 = await publish(gm, samShift.scheduleId)
    expect(v2.notifiedPeople).toBe(1)
    const v2Notices = (await notificationsFor(samShift.scheduleId)).filter(
      (n) => n.purpose === 'v2' && n.channel === 'in_app',
    )
    expect(v2Notices.map((n) => n.employment_id)).toEqual([sam.employmentId])
    expect(
      (await asTenant(harborId, (tx) => getMyShift(tx, sam, samShift.shiftId))).shift.time,
    ).toBe('5:00 PM – 10:00 PM')

    // Reassign Ava's shift to Camille: both of them, and only them, are told.
    await asTenant(harborId, (tx) => assignShift(tx, gm, avaShift.shiftId, camille.employmentId))
    await publish(gm, samShift.scheduleId)
    const v3 = (await notificationsFor(samShift.scheduleId)).filter(
      (n) => n.purpose === 'v3' && n.channel === 'in_app',
    )
    expect(v3.map((n) => n.employment_id).sort()).toEqual(
      [ava.employmentId, camille.employmentId].sort(),
    )

    // Cancel Camille's shift: gone for her only after the change is published.
    expect(await asTenant(harborId, (tx) => cancelShift(tx, gm, avaShift.shiftId))).toBe(
      'cancelled',
    )
    expect(
      (
        await asTenant(harborId, (tx) => getMySchedule(tx, camille, { weekStart: weekOf(date) }))
      ).upcoming.map((s) => s.id),
    ).toContain(avaShift.shiftId)
    await publish(gm, samShift.scheduleId)
    expect(
      (
        await asTenant(harborId, (tx) => getMySchedule(tx, camille, { weekStart: weekOf(date) }))
      ).upcoming.map((s) => s.id),
    ).not.toContain(avaShift.shiftId)
  })

  it('deletes a shift nobody was ever told about', async () => {
    const riverside = await location(harborId, 'Riverside')
    const gm = await harbor.gmRiverside()
    const { shiftId } = await makeShift(gm, riverside, dateIn(8, 6), '10:00', '12:00', null)
    expect(await asTenant(harborId, (tx) => cancelShift(tx, gm, shiftId))).toBe('deleted')
    expect(await shiftRow(shiftId)).toBeUndefined()
  })

  it('publishes once when two managers press publish together', async () => {
    const riverside = await location(harborId, 'Riverside')
    const gm = await harbor.gmRiverside()
    const scheduler = await harbor.scheduler()
    const sam = await harbor.sam()
    const { scheduleId } = await makeShift(
      gm,
      riverside,
      dateIn(9, 3),
      '16:00',
      '22:00',
      sam.employmentId,
    )
    const results = await Promise.allSettled([
      publish(gm, scheduleId),
      publish(scheduler, scheduleId),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const [row] = await query<{ published_version: number }>(
      'select published_version from schedules where id = $1',
      [scheduleId],
    )
    expect(row!.published_version).toBe(1)
    expect((await notificationsFor(scheduleId)).filter((n) => n.channel === 'in_app')).toHaveLength(
      1,
    )
  })
})

describe('open shifts', () => {
  it('gives the shift to one person, tells the others, and survives two managers approving at once', async () => {
    const riverside = await location(harborId, 'Riverside')
    const gm = await harbor.gmRiverside()
    const scheduler = await harbor.scheduler()
    const sam = await harbor.sam()
    const ava = await harbor.ava()
    const date = dateIn(10, 4)
    const { shiftId, scheduleId } = await makeShift(gm, riverside, date, '17:00', '22:00', null)
    await asTenant(harborId, (tx) => setShiftOpen(tx, gm, shiftId, true))
    const published = await publish(gm, scheduleId)
    expect(published.openShiftNotices).toBeGreaterThan(0)

    const samClaim = await asTenant(harborId, (tx) => claimOpenShift(tx, sam, shiftId, ''))
    const avaClaim = await asTenant(harborId, (tx) => claimOpenShift(tx, ava, shiftId, ''))
    await expect(asTenant(harborId, (tx) => claimOpenShift(tx, sam, shiftId, ''))).rejects.toThrow(
      /already asked/,
    )

    const results = await Promise.allSettled([
      asTenant(harborId, (tx) => decideClaim(tx, gm, samClaim.id, 'approved', '')),
      asTenant(harborId, (tx) => decideClaim(tx, scheduler, avaClaim.id, 'approved', '')),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)

    const row = await shiftRow(shiftId)
    expect([sam.employmentId, ava.employmentId]).toContain(row!.assignee_employment_id)
    expect(row!.published_assignee_employment_id).toBe(row!.assignee_employment_id)
    expect(row!.is_open).toBe(false)

    const claims = await query<{ status: string }>(
      'select status from open_shift_claims where shift_id = $1 order by status',
      [shiftId],
    )
    expect(claims.map((c) => c.status)).toEqual(['approved', 'declined'])
  })

  it('refuses a claim from someone who cannot work it', async () => {
    const riverside = await location(harborId, 'Riverside')
    const gm = await harbor.gmRiverside()
    const sam = await harbor.sam()
    const date = dateIn(10, 6)
    await makeShift(gm, riverside, date, '15:00', '23:00', sam.employmentId)
    const open = await makeShift(gm, riverside, date, '18:00', '22:00', null)
    await asTenant(harborId, (tx) => setShiftOpen(tx, gm, open.shiftId, true))
    await publish(gm, open.scheduleId)
    await expect(
      asTenant(harborId, (tx) => claimOpenShift(tx, sam, open.shiftId, '')),
    ).rejects.toThrow(/overlaps/)
  })
})

describe('swaps', () => {
  async function publishedShiftFor(
    person: Actor,
    weeks: number,
    weekday: number,
    start: string,
    end: string,
  ) {
    const riverside = await location(harborId, 'Riverside')
    const gm = await harbor.gmRiverside()
    const made = await makeShift(
      gm,
      riverside,
      dateIn(weeks, weekday),
      start,
      end,
      person.employmentId,
    )
    await publish(gm, made.scheduleId).catch(() => undefined)
    return made
  }

  it('completes a giveaway: the colleague agrees, a manager approves, the schedule moves', async () => {
    const gm = await harbor.gmRiverside()
    const sam = await harbor.sam()
    const ava = await harbor.ava()
    const { shiftId } = await publishedShiftFor(sam, 11, 3, '16:00', '22:00')

    const requestId = await asTenant(harborId, (tx) =>
      requestSwap(tx, sam, {
        shiftId,
        recipientEmploymentId: ava.employmentId,
        kind: 'giveaway',
        recipientShiftId: null,
        note: '',
      }),
    )
    await expect(
      asTenant(harborId, (tx) =>
        requestSwap(tx, sam, {
          shiftId,
          recipientEmploymentId: ava.employmentId,
          kind: 'giveaway',
          recipientShiftId: null,
          note: '',
        }),
      ),
    ).rejects.toThrow(/already a swap in progress/)
    // The manager cannot approve before the colleague has agreed.
    await expect(
      asTenant(harborId, (tx) => decideSwap(tx, gm, requestId, 'approved', '')),
    ).rejects.toThrow(/not agreed/)
    // Only the named colleague can answer.
    const camille = await harbor.camille()
    await expect(
      asTenant(harborId, (tx) => respondToSwap(tx, camille, requestId, true)),
    ).rejects.toBeInstanceOf(NotFoundError)

    await asTenant(harborId, (tx) => respondToSwap(tx, ava, requestId, true))
    expect(await asTenant(harborId, (tx) => decideSwap(tx, gm, requestId, 'approved', ''))).toBe(
      'approved',
    )

    const row = await shiftRow(shiftId)
    expect(row!.assignee_employment_id).toBe(ava.employmentId)
    expect(row!.published_assignee_employment_id).toBe(ava.employmentId)
    expect(await auditCount(requestId, 'shift_swap.approved')).toBe(1)
    const told = (await notificationsFor(requestId)).filter(
      (n) => n.purpose === 'approved' && n.channel === 'in_app',
    )
    expect(told.map((n) => n.employment_id).sort()).toEqual(
      [sam.employmentId, ava.employmentId].sort(),
    )
  })

  it('completes a trade in one step', async () => {
    const gm = await harbor.gmRiverside()
    const sam = await harbor.sam()
    const ava = await harbor.ava()
    const mine = await publishedShiftFor(sam, 12, 3, '16:00', '22:00')
    const theirs = await publishedShiftFor(ava, 12, 5, '16:00', '22:00')

    const requestId = await asTenant(harborId, (tx) =>
      requestSwap(tx, sam, {
        shiftId: mine.shiftId,
        recipientEmploymentId: ava.employmentId,
        kind: 'trade',
        recipientShiftId: theirs.shiftId,
        note: '',
      }),
    )
    await asTenant(harborId, (tx) => respondToSwap(tx, ava, requestId, true))
    expect(await asTenant(harborId, (tx) => decideSwap(tx, gm, requestId, 'approved', ''))).toBe(
      'approved',
    )
    expect((await shiftRow(mine.shiftId))!.assignee_employment_id).toBe(ava.employmentId)
    expect((await shiftRow(theirs.shiftId))!.assignee_employment_id).toBe(sam.employmentId)
  })

  it('lets exactly one of two managers approve the same swap', async () => {
    const gm = await harbor.gmRiverside()
    const scheduler = await harbor.scheduler()
    const sam = await harbor.sam()
    const ava = await harbor.ava()
    const { shiftId } = await publishedShiftFor(sam, 13, 3, '16:00', '22:00')
    const requestId = await asTenant(harborId, (tx) =>
      requestSwap(tx, sam, {
        shiftId,
        recipientEmploymentId: ava.employmentId,
        kind: 'giveaway',
        recipientShiftId: null,
        note: '',
      }),
    )
    await asTenant(harborId, (tx) => respondToSwap(tx, ava, requestId, true))

    const results = await Promise.allSettled([
      asTenant(harborId, (tx) => decideSwap(tx, gm, requestId, 'approved', '')),
      asTenant(harborId, (tx) => decideSwap(tx, scheduler, requestId, 'approved', '')),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await auditCount(requestId, 'shift_swap.approved')).toBe(1)
    expect((await shiftRow(shiftId))!.assignee_employment_id).toBe(ava.employmentId)
  })

  it('applies only one of two competing swaps for the same shift, approved at the same moment', async () => {
    const gm = await harbor.gmRiverside()
    const scheduler = await harbor.scheduler()
    const sam = await harbor.sam()
    const ava = await harbor.ava()
    const camille = await harbor.camille()
    const contested = await publishedShiftFor(sam, 14, 3, '16:00', '22:00')
    const camilles = await publishedShiftFor(camille, 14, 5, '17:00', '23:00')

    // Request A: Sam gives the shift to Ava.
    const giveaway = await asTenant(harborId, (tx) =>
      requestSwap(tx, sam, {
        shiftId: contested.shiftId,
        recipientEmploymentId: ava.employmentId,
        kind: 'giveaway',
        recipientShiftId: null,
        note: '',
      }),
    )
    await asTenant(harborId, (tx) => respondToSwap(tx, ava, giveaway, true))
    // Request B: Camille trades her shift for that same shift of Sam's.
    const trade = await asTenant(harborId, (tx) =>
      requestSwap(tx, camille, {
        shiftId: camilles.shiftId,
        recipientEmploymentId: sam.employmentId,
        kind: 'trade',
        recipientShiftId: contested.shiftId,
        note: '',
      }),
    )
    await asTenant(harborId, (tx) => respondToSwap(tx, sam, trade, true))

    const results = await Promise.allSettled([
      asTenant(harborId, (tx) => decideSwap(tx, gm, giveaway, 'approved', '')),
      asTenant(harborId, (tx) => decideSwap(tx, scheduler, trade, 'approved', '')),
    ])
    const outcomes = results.map((r) => (r.status === 'fulfilled' ? r.value : 'rejected'))
    expect(outcomes.filter((o) => o === 'approved')).toHaveLength(1)

    const row = await shiftRow(contested.shiftId)
    // The contested shift belongs to exactly the winner, on both copies.
    expect([ava.employmentId, camille.employmentId]).toContain(row!.assignee_employment_id)
    expect(row!.published_assignee_employment_id).toBe(row!.assignee_employment_id)
    const statuses = await query<{ status: string }>(
      'select status from shift_swap_requests where id in ($1, $2) order by status',
      [giveaway, trade],
    )
    expect(statuses.map((s) => s.status).filter((s) => s === 'approved')).toHaveLength(1)
    expect(statuses.map((s) => s.status)).not.toContain('pending_manager')
  })

  it('does not apply a swap to a shift a manager changed after it was agreed', async () => {
    const gm = await harbor.gmRiverside()
    const sam = await harbor.sam()
    const ava = await harbor.ava()
    const date = dateIn(15, 3)
    const { shiftId } = await publishedShiftFor(sam, 15, 3, '16:00', '22:00')
    const requestId = await asTenant(harborId, (tx) =>
      requestSwap(tx, sam, {
        shiftId,
        recipientEmploymentId: ava.employmentId,
        kind: 'giveaway',
        recipientShiftId: null,
        note: '',
      }),
    )
    await asTenant(harborId, (tx) => respondToSwap(tx, ava, requestId, true))
    await asTenant(harborId, (tx) =>
      updateShift(tx, gm, shiftId, {
        date,
        startMinute: H('15:00'),
        endMinute: H('22:00'),
        breakMinutes: 0,
        jobRoleId: null,
        stationId: null,
        notes: '',
      }),
    )
    expect(await asTenant(harborId, (tx) => decideSwap(tx, gm, requestId, 'approved', ''))).toBe(
      'expired',
    )
    expect((await shiftRow(shiftId))!.assignee_employment_id).toBe(sam.employmentId)
  })

  it('keeps swaps inside the manager’s own locations', async () => {
    const gmDowntown = await harbor.gmDowntown()
    const sam = await harbor.sam()
    const ava = await harbor.ava()
    const { shiftId } = await publishedShiftFor(sam, 16, 3, '16:00', '22:00')
    const requestId = await asTenant(harborId, (tx) =>
      requestSwap(tx, sam, {
        shiftId,
        recipientEmploymentId: ava.employmentId,
        kind: 'giveaway',
        recipientShiftId: null,
        note: '',
      }),
    )
    await asTenant(harborId, (tx) => respondToSwap(tx, ava, requestId, true))
    await expect(
      asTenant(harborId, (tx) => decideSwap(tx, gmDowntown, requestId, 'approved', '')),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})
