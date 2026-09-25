import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  assignToSlot,
  autofillWeek,
  clearSlot,
  createTemplateSet,
  generateWeek,
  listTemplateSets,
  setDayReview,
  weekReview,
} from '@/modules/scheduling/slotted'
import { availabilityStateFor } from '@/modules/scheduling/availability-state'
import { resolveActor } from '@/server/authz/resolve'
import type { Actor } from '@/server/authz/actor'
import { ValidationError } from '@/lib/errors'
import { asTenant, closeTestPools, migrationClient, organizationIdBySlug } from '../helpers/tenant'

/**
 * SLOTTED SCHEDULING, against real PostgreSQL.
 *
 * The promises round 2 makes, and the ones a manager would be right to be
 * angry about if they turned out to be false:
 *
 *   approved time off can never be assigned, by anybody, for any reason
 *   declared unavailability warns once and is recorded when overridden
 *   autofill never schedules over time off and never creates overtime
 *   autofill never publishes
 *   a one-off edit never changes the template it came from
 *   a day that changes stops counting as reviewed
 */

let harborId: string
const userIds = new Map<string, string>()

const GM = 'marcus@harborvine.test'
const EMPLOYEE = 'sam@harborvine.test'

beforeAll(async () => {
  harborId = await organizationIdBySlug('harbor-vine')
  const pool = await migrationClient()
  const users = await pool.query<{ id: string; email: string }>('select id, email from "user"')
  for (const row of users.rows) userIds.set(row.email, row.id)
})

afterAll(async () => {
  await closeTestPools()
})

async function actorFor(email: string): Promise<Actor> {
  const userId = userIds.get(email)
  if (!userId) throw new Error(`Seeded user ${email} not found`)
  const actor = await asTenant(harborId, (tx) => resolveActor(tx, harborId, userId))
  if (!actor) throw new Error(`No actor for ${email}`)
  return actor
}

async function idOf(table: string, column: string, value: string): Promise<string> {
  const pool = await migrationClient()
  const { rows } = await pool.query<{ id: string }>(
    `select id from ${table} where organization_id = $1 and ${column} = $2 limit 1`,
    [harborId, value],
  )
  if (!rows[0]) throw new Error(`No ${table} with ${column} = ${value}`)
  return rows[0].id
}

/**
 * A week far enough out that nothing else in the suite touches it.
 *
 * `ensureSchedule` reuses an existing schedule for a (location, week), so a
 * week another test file has already built would hand these tests somebody
 * else's shifts. 2029 is nobody's fixture.
 */
function farWeek(offsetWeeks: number): string {
  const monday = new Date('2029-01-01T00:00:00Z')
  monday.setUTCDate(monday.getUTCDate() + offsetWeeks * 7)
  return monday.toISOString().slice(0, 10)
}

async function freshTemplate(actor: Actor, locationId: string, name: string) {
  const serverRole = await idOf('job_roles', 'name', 'Server')
  return asTenant(harborId, (tx) =>
    createTemplateSet(tx, actor, locationId, {
      name,
      openDays: [1, 2, 3],
      mealMinutes: 30,
      mealAfterMinutes: 300,
      restMinutes: 10,
      restEveryMinutes: 240,
      staggerBreaks: true,
      patterns: [
        {
          name: 'Server · dinner',
          jobRoleId: serverRole,
          startMinute: 16 * 60,
          endMinute: 22 * 60,
          headcount: 2,
          daysOfWeek: [1, 2, 3],
        },
      ],
    }),
  )
}

describe('approved time off', () => {
  it('cannot be assigned over, with or without an override', async () => {
    const gm = await actorFor(GM)
    const riverside = await idOf('locations', 'name', 'Riverside')
    const templateId = await freshTemplate(gm, riverside, `Time off ${Date.now()}`)
    const week = farWeek(1)
    const { scheduleId } = await asTenant(harborId, (tx) =>
      generateWeek(tx, gm, { locationId: riverside, weekStart: week, templateSetId: templateId }),
    )

    const review = await asTenant(harborId, (tx) => weekReview(tx, gm, scheduleId))
    const slot = review.days.flatMap((d) => d.shifts)[0]!

    // Give somebody approved time off across the whole week.
    const employee = await actorFor(EMPLOYEE)
    const pool = await migrationClient()
    const { rows } = await pool.query<{ id: string }>(
      `insert into time_off_requests
         (id, organization_id, employment_id, starts_on, ends_on, reason, status,
          decided_by_employment_id, decided_at)
       values (gen_random_uuid(), $1, $2, $3, $4, 'personal', 'approved', $5, now())
       returning id`,
      [harborId, employee.employmentId, week, farWeek(2), gm.employmentId],
    )

    // The reason is in the field error, which is what a form shows.
    const refusal = async (options?: { overrideUnavailable: boolean; reason: string }) => {
      try {
        await asTenant(harborId, (tx) =>
          assignToSlot(tx, gm, slot.id, employee.employmentId, options),
        )
        return null
      } catch (error) {
        return error instanceof ValidationError
          ? error.fieldErrors.employmentId?.[0]
          : String(error)
      }
    }

    try {
      expect(await refusal()).toMatch(/approved time off/i)

      // And the override flag does not help: there is no override for time off.
      expect(await refusal({ overrideUnavailable: true, reason: 'We are short' })).toMatch(
        /approved time off/i,
      )

      // Autofill does not reach for them either.
      await asTenant(harborId, (tx) => autofillWeek(tx, gm, scheduleId))
      const after = await asTenant(harborId, (tx) => weekReview(tx, gm, scheduleId))
      const theirs = after.days
        .flatMap((d) => d.shifts)
        .filter((s) => s.assigneeId === employee.employmentId)
      expect(theirs).toHaveLength(0)
    } finally {
      await pool.query('delete from time_off_requests where id = $1', [rows[0]!.id])
    }
  })
})

describe('declared unavailability', () => {
  it('warns once, then records the override in the manager’s name', async () => {
    const gm = await actorFor(GM)
    const employee = await actorFor(EMPLOYEE)
    const riverside = await idOf('locations', 'name', 'Riverside')
    const templateId = await freshTemplate(gm, riverside, `Override ${Date.now()}`)
    const week = farWeek(3)
    const { scheduleId } = await asTenant(harborId, (tx) =>
      generateWeek(tx, gm, { locationId: riverside, weekStart: week, templateSetId: templateId }),
    )

    // Make this person unavailable for every shift in the week.
    const pool = await migrationClient()
    const { rows: rules } = await pool.query<{ id: string }>(
      `insert into availability_rules (id, organization_id, employment_id, weekday, start_minute, end_minute, preference)
       select gen_random_uuid(), $1, $2, d, 0, 1440, 'unavailable' from generate_series(1, 7) d
       returning id`,
      [harborId, employee.employmentId],
    )

    try {
      const review = await asTenant(harborId, (tx) => weekReview(tx, gm, scheduleId))
      const slot = review.days.flatMap((d) => d.shifts)[0]!

      await expect(
        asTenant(harborId, (tx) => assignToSlot(tx, gm, slot.id, employee.employmentId)),
      ).rejects.toThrow(ValidationError)

      const result = await asTenant(harborId, (tx) =>
        assignToSlot(tx, gm, slot.id, employee.employmentId, {
          overrideUnavailable: true,
          reason: 'Nobody else is qualified.',
        }),
      )
      expect(result.overridden).toBe(true)

      const after = await asTenant(harborId, (tx) => weekReview(tx, gm, scheduleId))
      expect(after.overrides).toHaveLength(1)
      expect(after.overrides[0]!.name).toBe('Sam Whitfield')
      expect(after.overrides[0]!.reason).toBe('Nobody else is qualified.')

      // Taking them off takes the override with them.
      await asTenant(harborId, (tx) => clearSlot(tx, gm, slot.id))
      const cleared = await asTenant(harborId, (tx) => weekReview(tx, gm, scheduleId))
      expect(cleared.overrides).toHaveLength(0)
    } finally {
      await pool.query('delete from availability_rules where id = any($1)', [
        rules.map((r) => r.id),
      ])
    }
  })
})

describe('autofill', () => {
  it('leaves the week a draft, and never creates overtime', async () => {
    const gm = await actorFor(GM)
    const riverside = await idOf('locations', 'name', 'Riverside')
    const templateId = await freshTemplate(gm, riverside, `Autofill ${Date.now()}`)
    const week = farWeek(5)
    const { scheduleId } = await asTenant(harborId, (tx) =>
      generateWeek(tx, gm, { locationId: riverside, weekStart: week, templateSetId: templateId }),
    )

    const result = await asTenant(harborId, (tx) => autofillWeek(tx, gm, scheduleId))
    expect(result.filled).toBeGreaterThan(0)

    const review = await asTenant(harborId, (tx) => weekReview(tx, gm, scheduleId))
    expect(review.status).toBe('draft')
    for (const person of review.hours) expect(person.minutes).toBeLessThanOrEqual(40 * 60)

    // Every filled slot went to somebody who did not say no.
    const assigned = review.days.flatMap((d) => d.shifts).filter((s) => s.assigneeId)
    for (const shift of assigned) {
      expect(shift.state === 'available' || shift.state === 'not_preferred').toBe(true)
    }
  })
})

describe('a one-off edit', () => {
  it('never changes the template it came from', async () => {
    const gm = await actorFor(GM)
    const employee = await actorFor(EMPLOYEE)
    const riverside = await idOf('locations', 'name', 'Riverside')
    const name = `One-off ${Date.now()}`
    const templateId = await freshTemplate(gm, riverside, name)
    const week = farWeek(7)
    const { scheduleId } = await asTenant(harborId, (tx) =>
      generateWeek(tx, gm, { locationId: riverside, weekStart: week, templateSetId: templateId }),
    )

    const before = (await asTenant(harborId, (tx) => listTemplateSets(tx, gm, riverside))).find(
      (set) => set.name === name,
    )!

    const review = await asTenant(harborId, (tx) => weekReview(tx, gm, scheduleId))
    const slot = review.days.flatMap((d) => d.shifts)[0]!
    await asTenant(harborId, (tx) =>
      assignToSlot(tx, gm, slot.id, employee.employmentId, { overrideUnavailable: true }),
    )

    const after = (await asTenant(harborId, (tx) => listTemplateSets(tx, gm, riverside))).find(
      (set) => set.name === name,
    )!
    expect(after.slotsPerWeek).toBe(before.slotsPerWeek)
    expect(after.patterns).toBe(before.patterns)
    expect(after.weeklyMinutes).toBe(before.weeklyMinutes)
  })
})

describe('the review stack', () => {
  it('forgets a day that changed after it was approved', async () => {
    const gm = await actorFor(GM)
    const employee = await actorFor(EMPLOYEE)
    const riverside = await idOf('locations', 'name', 'Riverside')
    const templateId = await freshTemplate(gm, riverside, `Review ${Date.now()}`)
    const week = farWeek(9)
    const { scheduleId } = await asTenant(harborId, (tx) =>
      generateWeek(tx, gm, { locationId: riverside, weekStart: week, templateSetId: templateId }),
    )

    const review = await asTenant(harborId, (tx) => weekReview(tx, gm, scheduleId))
    const day = review.days.find((d) => d.slots > 0)!
    await asTenant(harborId, (tx) => setDayReview(tx, gm, scheduleId, day.date, 'approved'))

    const approved = await asTenant(harborId, (tx) => weekReview(tx, gm, scheduleId))
    expect(approved.days.find((d) => d.date === day.date)!.state).toBe('approved')

    // Changing who works it makes the approval stale, so it comes back.
    await asTenant(harborId, (tx) =>
      assignToSlot(tx, gm, day.shifts[0]!.id, employee.employmentId, {
        overrideUnavailable: true,
      }),
    )
    const stale = await asTenant(harborId, (tx) => weekReview(tx, gm, scheduleId))
    expect(stale.days.find((d) => d.date === day.date)!.state).toBe('pending')
  })
})

describe('the four availability states', () => {
  const zone = 'America/Los_Angeles'
  const shift = {
    startsAt: new Date('2027-06-08T23:00:00Z'), // Tue 4pm local
    endsAt: new Date('2027-06-09T05:00:00Z'), // Tue 10pm local
    timeZone: zone,
  }
  const person = (
    rules: { weekday: number; startMinute: number; endMinute: number; preference: string }[],
    timeOff: { status: string; startsOn: string; endsOn: string }[] = [],
  ) => ({
    availabilityRules: rules,
    availabilityExceptions: [],
    timeOff: timeOff.map((t, i) => ({
      id: String(i),
      startsOn: t.startsOn,
      endsOn: t.endsOn,
      startMinute: null,
      endMinute: null,
      status: t.status,
    })),
  })

  it('reads preferred hours as available', () => {
    expect(
      availabilityStateFor(
        shift,
        person([{ weekday: 2, startMinute: 15 * 60, endMinute: 23 * 60, preference: 'preferred' }]),
      ),
    ).toBe('available')
  })

  it('reads merely-possible hours as not preferred', () => {
    expect(
      availabilityStateFor(
        shift,
        person([{ weekday: 2, startMinute: 15 * 60, endMinute: 23 * 60, preference: 'available' }]),
      ),
    ).toBe('not_preferred')
  })

  it('lets one "no" anywhere in the shift decide the whole shift', () => {
    expect(
      availabilityStateFor(
        shift,
        person([
          { weekday: 2, startMinute: 15 * 60, endMinute: 18 * 60, preference: 'preferred' },
          { weekday: 2, startMinute: 21 * 60, endMinute: 24 * 60, preference: 'unavailable' },
        ]),
      ),
    ).toBe('unavailable')
  })

  it('puts approved time off above everything else', () => {
    expect(
      availabilityStateFor(
        shift,
        person(
          [{ weekday: 2, startMinute: 0, endMinute: 1440, preference: 'preferred' }],
          [{ status: 'approved', startsOn: '2027-06-08', endsOn: '2027-06-08' }],
        ),
      ),
    ).toBe('time_off')
  })

  it('does not hold somebody to a preference they never expressed', () => {
    expect(availabilityStateFor(shift, person([]))).toBe('available')
  })
})
