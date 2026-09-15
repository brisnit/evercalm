import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { addCalendarDays } from '@/lib/dates'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { resolveActor } from '@/server/authz/resolve'
import type { Actor } from '@/server/authz/actor'
import {
  assignShift,
  cancelShift,
  createShift,
  loadWeek,
  publishSchedule,
  setShiftOpen,
  updateShift,
} from '@/modules/scheduling/service'
import { claimOpenShift, decideClaim } from '@/modules/scheduling/requests'
import {
  isoWeekday,
  localDateOf,
  parseTimeOfDay,
  weekDates,
  weekStartOf,
} from '@/modules/scheduling/time'
import { pgErrorCode, StaleTaskError } from '@/modules/operations/access'
import type { TaskView } from '@/modules/operations/items'
import {
  getBoard,
  reassignTask,
  reopenTask,
  returnTask,
  verifyTask,
} from '@/modules/operations/board'
import { syncOperationsForShifts } from '@/modules/operations/generation'
import {
  acknowledgeHandoff,
  createHandoff,
  reopenHandoff,
  resolveHandoff,
} from '@/modules/operations/handoffs'
import { processOperationsReminders } from '@/modules/operations/reminders'
import {
  addSection,
  addTask,
  createTemplate,
  getTemplate,
  listTemplates,
  publishDraft,
  setDraftTargets,
  startNewDraft,
  updateTask,
  type TaskInput,
} from '@/modules/operations/templates'
import {
  blockTask,
  completeHandoffTask,
  completeTask,
  getMyShiftWork,
  skipTask,
  undoTask,
} from '@/modules/operations/work'
import {
  asTenant,
  closeTestPools,
  migrationClient,
  organizationIdBySlug,
  rawAsApp,
} from '../helpers/tenant'

/**
 * SHIFT OPERATIONS, END TO END, against real PostgreSQL.
 *
 * The promises under test:
 *
 *   work exists only for PUBLISHED shifts, once per shift and template
 *   swaps, claims, reassignment, time changes and cancellations move or retire
 *     open work and never rewrite finished work
 *   a published template version never changes, and runs keep their version
 *   two people acting on one task at once cannot both win
 *   nobody completes a colleague's task unless it is shared
 *   managers act only where they hold the capability; everyone else gets 404
 *   overnight shifts and a second timezone land on the right business date
 *   records cannot be deleted by the application
 *
 * Every test works in its own far-future week, clear of the seeded weeks, the
 * scheduling tests and each other.
 */

const LA = 'America/Los_Angeles'
const H = (hhmm: string) => parseTimeOfDay(hhmm)!
const HOUR = 3_600_000

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
  const resolved = await asTenant(organizationId, (tx) =>
    resolveActor(tx, organizationId, users.get(email)!),
  )
  if (!resolved) throw new Error(`No actor for ${email}`)
  return resolved
}

const harbor = {
  owner: () => actor(harborId, 'dana@harborvine.test'),
  gmRiverside: () => actor(harborId, 'marcus@harborvine.test'),
  gmDowntown: () => actor(harborId, 'tess@harborvine.test'),
  scheduler: () => actor(harborId, 'omar@harborvine.test'),
  lead: () => actor(harborId, 'jordan@harborvine.test'),
  sam: () => actor(harborId, 'sam@harborvine.test'),
  ava: () => actor(harborId, 'ava@harborvine.test'),
}
const lumen = {
  owner: () => actor(lumenId, 'ana@lumensalon.test'),
  ruben: () => actor(lumenId, 'ruben@lumensalon.test'),
}

async function query<T extends Record<string, unknown>>(sql: string, params: unknown[] = []) {
  const pool = await migrationClient()
  return (await pool.query<T>(sql, params)).rows
}

async function idWhere(table: string, organizationId: string, column: string, value: string) {
  const [row] = await query<{ id: string }>(
    `select id from ${table} where organization_id = $1 and ${column} = $2 limit 1`,
    [organizationId, value],
  )
  if (!row) throw new Error(`No ${table}.${column} = ${value}`)
  return row.id
}

const location = (org: string, name: string) => idWhere('locations', org, 'name', name)

/** A local date `weeks` weeks from now, on an ISO weekday. */
function dateIn(weeks: number, weekday: number, timeZone = LA): string {
  const start = addCalendarDays(weekStartOf(localDateOf(new Date(), timeZone)), 7 * weeks)
  return weekDates(start).find((d) => isoWeekday(d) === weekday)!
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise
    return 'no error'
  } catch (error) {
    return pgErrorCode(error)
  }
}

const unique = (name: string) => `${name} ${Math.random().toString(36).slice(2, 7)}`

const task = (over: Partial<TaskInput> = {}): TaskInput => ({
  title: 'Task',
  instructions: '',
  required: true,
  responseType: 'check',
  timingAnchor: 'shift_start',
  offsetMinutes: 0,
  requiresVerification: false,
  shared: false,
  ...over,
})

/** Build and publish a template; returns its id and published version id. */
async function publishedTemplate(
  org: string,
  author: Actor,
  input: {
    name: string
    kind?: string
    locationIds: string[]
    jobRoleIds?: string[]
    stationIds?: string[]
    tasks: Partial<TaskInput>[]
    now?: Date
  },
) {
  return asTenant(org, async (tx) => {
    const templateId = await createTemplate(tx, author, {
      name: input.name,
      kind: input.kind ?? 'side_work',
      locationIds: input.locationIds,
    })
    const detail = await getTemplate(tx, author, templateId)
    const versionId = detail.draft!.id
    await setDraftTargets(tx, author, versionId, {
      locationIds: input.locationIds,
      jobRoleIds: input.jobRoleIds ?? [],
      stationIds: input.stationIds ?? [],
    })
    const sectionId = await addSection(tx, author, versionId, 'Tasks')
    for (const t of input.tasks) await addTask(tx, author, sectionId, task(t))
    await publishDraft(tx, author, versionId, '', input.now)
    return { templateId, versionId }
  })
}

async function makeShift(
  org: string,
  manager: Actor,
  locationId: string,
  date: string,
  start: string,
  end: string,
  assignee: string | null,
  extra: { jobRoleId?: string | null; stationId?: string | null } = {},
) {
  const result = await asTenant(org, (tx) =>
    createShift(tx, manager, locationId, {
      date,
      startMinute: H(start),
      endMinute: H(end),
      breakMinutes: 0,
      jobRoleId: extra.jobRoleId ?? null,
      stationId: extra.stationId ?? null,
      notes: '',
      assigneeEmploymentId: assignee,
    }),
  )
  const board = await asTenant(org, (tx) => loadWeek(tx, manager, locationId, weekStartOf(date)))
  return { shiftId: result.id, scheduleId: board.schedule!.id }
}

const publish = (org: string, manager: Actor, scheduleId: string) =>
  asTenant(org, (tx) => publishSchedule(tx, manager, scheduleId))

async function runsFor(shiftId: string, templateId: string) {
  return query<{
    id: string
    status: string
    assignee_employment_id: string | null
    version_number: number
    business_date: string
  }>(
    `select id, status, assignee_employment_id, version_number, business_date::text
       from ops_runs where shift_id = $1 and template_id = $2`,
    [shiftId, templateId],
  )
}

async function itemsFor(runId: string) {
  return query<{
    id: string
    status: string
    assigned_employment_id: string | null
    reassigned_from_employment_id: string | null
    due_at: Date
    revision: number
    title: string
  }>(
    `select i.id, i.status, i.assigned_employment_id, i.reassigned_from_employment_id, i.due_at, i.revision, t.title
       from ops_task_items i join ops_tasks t on t.id = i.task_id
      where i.run_id = $1 order by t.position`,
    [runId],
  )
}

async function eventActions(itemId: string) {
  const rows = await query<{ action: string }>(
    'select action from ops_task_events where item_id = $1 order by at, action',
    [itemId],
  )
  return rows.map((r) => r.action)
}

// ---------------------------------------------------------------------------

describe('templates', () => {
  it('lets a location manager author only for their own locations', async () => {
    const riverside = await location(harborId, 'Riverside')
    const downtown = await location(harborId, 'Downtown')
    const marcus = await harbor.gmRiverside()
    const tess = await harbor.gmDowntown()
    const jordan = await harbor.lead()

    await expect(
      asTenant(harborId, (tx) =>
        createTemplate(tx, marcus, {
          name: unique('Downtown close'),
          kind: 'closing',
          locationIds: [downtown],
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError)
    // Every location is only for someone who manages every location.
    await expect(
      asTenant(harborId, (tx) =>
        createTemplate(tx, marcus, { name: unique('All'), kind: 'closing', locationIds: [] }),
      ),
    ).rejects.toBeInstanceOf(ValidationError)

    const { templateId } = await publishedTemplate(harborId, marcus, {
      name: unique('Riverside close'),
      kind: 'closing',
      locationIds: [riverside],
      tasks: [{ title: 'Lock the patio doors' }],
    })

    // Another location's manager learns nothing about it.
    await expect(
      asTenant(harborId, (tx) => getTemplate(tx, tess, templateId)),
    ).rejects.toBeInstanceOf(NotFoundError)
    // A shift lead can read it, but not change it.
    await expect(
      asTenant(harborId, (tx) => getTemplate(tx, jordan, templateId)),
    ).resolves.toBeTruthy()
    await expect(
      asTenant(harborId, (tx) => startNewDraft(tx, jordan, templateId)),
    ).rejects.toBeInstanceOf(ForbiddenError)
    // Employees and other tenants: not found.
    await expect(
      asTenant(harborId, async (tx) => listTemplates(tx, await harbor.sam())),
    ).rejects.toBeInstanceOf(NotFoundError)
    const ana = await lumen.owner()
    await expect(
      asTenant(lumenId, (tx) => getTemplate(tx, ana, templateId)),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('never changes a published version, in the service or in the database', async () => {
    const riverside = await location(harborId, 'Riverside')
    const dana = await harbor.owner()
    const { templateId, versionId } = await publishedTemplate(harborId, dana, {
      name: unique('Opening duties'),
      kind: 'opening',
      locationIds: [riverside],
      tasks: [{ title: 'Turn on the dish machine' }],
    })
    const [published] = await query<{ id: string }>(
      'select id from ops_tasks where version_id = $1',
      [versionId],
    )

    await expect(
      asTenant(harborId, (tx) => updateTask(tx, dana, published!.id, task({ title: 'Changed' }))),
    ).rejects.toBeInstanceOf(ValidationError)
    // Even the application role going around the service is refused.
    expect(
      await codeOf(
        rawAsApp(harborId, `update ops_tasks set title = 'Changed' where id = $1`, [published!.id]),
      ),
    ).toBe('55000')
    expect(
      await codeOf(
        rawAsApp(harborId, `delete from ops_sections where version_id = $1`, [versionId]),
      ),
    ).toBe('55000')

    // A new draft is a copy; the published version is untouched.
    const draftId = await asTenant(harborId, (tx) => startNewDraft(tx, dana, templateId))
    const detail = await asTenant(harborId, (tx) => getTemplate(tx, dana, templateId))
    expect(detail.draft!.id).toBe(draftId)
    expect(detail.draft!.versionNumber).toBe(2)
    expect(detail.draft!.sections[0]!.tasks[0]!.title).toBe('Turn on the dish machine')
    expect(detail.published!.targets.locationIds).toEqual([riverside])
  })
})

describe('from a published shift to its work', () => {
  it('creates work only when the shift is published, exactly once', async () => {
    const riverside = await location(harborId, 'Riverside')
    const server = await idWhere('job_roles', harborId, 'name', 'Server')
    const marcus = await harbor.gmRiverside()
    const sam = await harbor.sam()
    const { templateId } = await publishedTemplate(harborId, marcus, {
      name: unique('Server side work'),
      locationIds: [riverside],
      jobRoleIds: [server],
      tasks: [
        { title: 'Uniform check', timingAnchor: 'shift_start', offsetMinutes: -15 },
        { title: 'Roll silverware', timingAnchor: 'shift_end', offsetMinutes: -30 },
      ],
    })

    const date = dateIn(30, 4)
    const { shiftId, scheduleId } = await makeShift(
      harborId,
      marcus,
      riverside,
      date,
      '16:00',
      '22:00',
      sam.employmentId,
      {
        jobRoleId: server,
      },
    )
    // A draft shift has no work, and the employee sees nothing.
    expect(await runsFor(shiftId, templateId)).toHaveLength(0)
    const startsAt = new Date(
      (
        await query<{ starts_at: Date }>('select starts_at from shifts where id = $1', [shiftId])
      )[0]!.starts_at,
    )
    await expect(
      asTenant(harborId, (tx) =>
        getMyShiftWork(tx, sam, { shiftId, now: new Date(startsAt.getTime() - HOUR) }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError)

    await publish(harborId, marcus, scheduleId)
    const [run] = await runsFor(shiftId, templateId)
    expect(run).toMatchObject({
      status: 'active',
      assignee_employment_id: sam.employmentId,
      business_date: date,
    })
    const items = await itemsFor(run!.id)
    expect(items.map((i) => i.title)).toEqual(['Uniform check', 'Roll silverware'])
    expect(items[0]!.due_at.getTime()).toBe(startsAt.getTime() - 15 * 60_000)

    // Generation is a reconciliation: running it again adds nothing.
    const again = await asTenant(harborId, (tx) =>
      syncOperationsForShifts(tx, harborId, [shiftId, shiftId], marcus.employmentId),
    )
    expect(again.created).toBe(0)
    expect(await runsFor(shiftId, templateId)).toHaveLength(1)
    expect(await itemsFor(run!.id)).toHaveLength(2)

    const work = await asTenant(harborId, (tx) =>
      getMyShiftWork(tx, sam, { shiftId, now: new Date(startsAt.getTime() - 20 * 60_000) }),
    )
    const mine = (Object.values(work!.buckets) as TaskView[][])
      .flat()
      .filter((i) => i.runId === run!.id)
    expect(mine).toHaveLength(2)

    // The pre-shift reminder goes once, in the hour before.
    const reminderAt = new Date(startsAt.getTime() - 30 * 60_000)
    const [due] = await query<{ organization_id: string }>(
      'select organization_id from evercalm_organizations_with_due_work($1) where organization_id = $2',
      [reminderAt, harborId],
    )
    expect(due).toBeTruthy()
    expect(
      await asTenant(harborId, (tx) => processOperationsReminders(tx, harborId, reminderAt)),
    ).toBeGreaterThanOrEqual(1)
    expect(
      await asTenant(harborId, (tx) => processOperationsReminders(tx, harborId, reminderAt)),
    ).toBe(0)
    const [notice] = await query<{ n: string }>(
      `select count(*) as n from notifications where subject_id = $1 and employment_id = $2 and category = 'operations'`,
      [shiftId, sam.employmentId],
    )
    expect(Number(notice!.n)).toBe(1)
  })

  it('follows new times and a new person, and leaves finished work where it was', async () => {
    const riverside = await location(harborId, 'Riverside')
    const server = await idWhere('job_roles', harborId, 'name', 'Server')
    const marcus = await harbor.gmRiverside()
    const sam = await harbor.sam()
    const ava = await harbor.ava()
    const { templateId } = await publishedTemplate(harborId, marcus, {
      name: unique('Dinner side work'),
      locationIds: [riverside],
      jobRoleIds: [server],
      tasks: [
        { title: 'Fold napkins', offsetMinutes: 0 },
        { title: 'Stock the side station', offsetMinutes: 60 },
      ],
    })
    const date = dateIn(31, 4)
    const { shiftId, scheduleId } = await makeShift(
      harborId,
      marcus,
      riverside,
      date,
      '16:00',
      '22:00',
      sam.employmentId,
      {
        jobRoleId: server,
      },
    )
    await publish(harborId, marcus, scheduleId)
    const [run] = await runsFor(shiftId, templateId)
    const [fold, stock] = await itemsFor(run!.id)
    const startsAt = fold!.due_at

    await asTenant(harborId, (tx) =>
      completeTask(
        tx,
        sam,
        fold!.id,
        { revision: fold!.revision },
        new Date(startsAt.getTime() - HOUR),
      ),
    )

    // Later start; published.
    await asTenant(harborId, (tx) =>
      updateShift(tx, marcus, shiftId, {
        date,
        startMinute: H('17:00'),
        endMinute: H('22:00'),
        breakMinutes: 0,
        jobRoleId: server,
        stationId: null,
        notes: '',
      }),
    )
    await publish(harborId, marcus, scheduleId)
    const moved = await itemsFor(run!.id)
    expect(moved.find((i) => i.id === stock!.id)!.due_at.getTime()).toBe(
      startsAt.getTime() + 2 * HOUR,
    )
    expect(await eventActions(stock!.id)).toContain('rescheduled')

    // Reassigned to Ava and published: open work goes with the shift.
    await asTenant(harborId, (tx) => assignShift(tx, marcus, shiftId, ava.employmentId))
    await publish(harborId, marcus, scheduleId)
    const [after] = await runsFor(shiftId, templateId)
    expect(after!.assignee_employment_id).toBe(ava.employmentId)
    const final = await itemsFor(run!.id)
    const finalFold = final.find((i) => i.id === fold!.id)!
    const finalStock = final.find((i) => i.id === stock!.id)!
    expect(finalFold).toMatchObject({ status: 'done', assigned_employment_id: sam.employmentId })
    expect(finalStock).toMatchObject({
      status: 'pending',
      assigned_employment_id: ava.employmentId,
      reassigned_from_employment_id: sam.employmentId,
    })
    const history = await query<{
      from_employment_id: string | null
      to_employment_id: string | null
    }>(
      'select from_employment_id, to_employment_id from ops_run_assignees where run_id = $1 order by changed_at',
      [run!.id],
    )
    expect(history.at(-1)).toEqual({
      from_employment_id: sam.employmentId,
      to_employment_id: ava.employmentId,
    })

    // Sam no longer has the shift; Ava's workspace has the open task.
    await expect(
      asTenant(harborId, (tx) => getMyShiftWork(tx, sam, { shiftId, now: startsAt })),
    ).rejects.toBeInstanceOf(NotFoundError)
    const avaWork = await asTenant(harborId, (tx) =>
      getMyShiftWork(tx, ava, { shiftId, now: startsAt }),
    )
    expect((Object.values(avaWork!.buckets) as TaskView[][]).flat().map((i) => i.id)).toContain(
      stock!.id,
    )
  })

  it('moves work when an approved claim fills an open shift', async () => {
    const riverside = await location(harborId, 'Riverside')
    const marcus = await harbor.gmRiverside()
    const ava = await harbor.ava()
    const { templateId } = await publishedTemplate(harborId, marcus, {
      name: unique('Host stand setup'),
      kind: 'station_setup',
      locationIds: [riverside],
      tasks: [{ title: 'Wipe menus' }],
    })
    const date = dateIn(33, 5)
    const { shiftId, scheduleId } = await makeShift(
      harborId,
      marcus,
      riverside,
      date,
      '11:00',
      '15:00',
      null,
    )
    await asTenant(harborId, (tx) => setShiftOpen(tx, marcus, shiftId, true))
    await publish(harborId, marcus, scheduleId)
    const [run] = await runsFor(shiftId, templateId)
    expect(run!.assignee_employment_id).toBeNull()

    const claim = await asTenant(harborId, (tx) => claimOpenShift(tx, ava, shiftId, ''))
    await asTenant(harborId, (tx) => decideClaim(tx, marcus, claim.id, 'approved', ''))
    const [after] = await runsFor(shiftId, templateId)
    expect(after!.assignee_employment_id).toBe(ava.employmentId)
    const [item] = await itemsFor(run!.id)
    expect(item!.assigned_employment_id).toBe(ava.employmentId)
  })

  it('retires open work when a shift is cancelled, and keeps what was done', async () => {
    const riverside = await location(harborId, 'Riverside')
    const marcus = await harbor.gmRiverside()
    const sam = await harbor.sam()
    const { templateId } = await publishedTemplate(harborId, marcus, {
      name: unique('Pre-shift'),
      kind: 'pre_shift',
      locationIds: [riverside],
      tasks: [{ title: 'Read the 86 list' }, { title: 'Check the reservation book' }],
    })
    const date = dateIn(32, 4)
    const { shiftId, scheduleId } = await makeShift(
      harborId,
      marcus,
      riverside,
      date,
      '16:00',
      '22:00',
      sam.employmentId,
    )
    await publish(harborId, marcus, scheduleId)
    const [run] = await runsFor(shiftId, templateId)
    const [read] = await itemsFor(run!.id)
    await asTenant(harborId, (tx) =>
      completeTask(
        tx,
        sam,
        read!.id,
        { revision: read!.revision },
        new Date(read!.due_at.getTime() - HOUR),
      ),
    )

    await asTenant(harborId, (tx) => cancelShift(tx, marcus, shiftId))
    // Not yet published: the run still stands.
    expect((await runsFor(shiftId, templateId))[0]!.status).toBe('active')
    await publish(harborId, marcus, scheduleId)
    expect((await runsFor(shiftId, templateId))[0]!.status).toBe('cancelled')
    const items = await itemsFor(run!.id)
    expect(items.map((i) => i.status)).toEqual(['done', 'pending'])
    expect(await eventActions(items[1]!.id)).toContain('cancelled')

    // Nothing to do on a cancelled shift.
    await expect(
      asTenant(harborId, (tx) =>
        completeTask(tx, sam, items[1]!.id, { revision: items[1]!.revision }, read!.due_at),
      ),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('doing the work', () => {
  async function shiftWithWork(week: number, tasks: Partial<TaskInput>[]) {
    const riverside = await location(harborId, 'Riverside')
    const marcus = await harbor.gmRiverside()
    const sam = await harbor.sam()
    const ava = await harbor.ava()
    const { templateId } = await publishedTemplate(harborId, marcus, {
      name: unique('Closing duties'),
      kind: 'closing',
      locationIds: [riverside],
      tasks,
    })
    const date = dateIn(week, 4)
    const samShift = await makeShift(
      harborId,
      marcus,
      riverside,
      date,
      '16:00',
      '22:00',
      sam.employmentId,
    )
    const avaShift = await makeShift(
      harborId,
      marcus,
      riverside,
      date,
      '17:00',
      '23:00',
      ava.employmentId,
    )
    await publish(harborId, marcus, samShift.scheduleId)
    const [run] = await runsFor(samShift.shiftId, templateId)
    const items = await itemsFor(run!.id)
    return { riverside, marcus, sam, ava, templateId, samShift, avaShift, run: run!, items, date }
  }

  it('lets only one of two simultaneous actions win', async () => {
    const { sam, items } = await shiftWithWork(34, [
      { title: 'Count the till', requiresVerification: true },
    ])
    const till = items[0]!
    const now = new Date(till.due_at.getTime() - HOUR)
    const [a, b] = await Promise.allSettled([
      asTenant(harborId, (tx) => completeTask(tx, sam, till.id, { revision: till.revision }, now)),
      asTenant(harborId, (tx) => completeTask(tx, sam, till.id, { revision: till.revision }, now)),
    ])
    const outcomes = [a, b].map((r) => r.status)
    expect(outcomes.sort()).toEqual(['fulfilled', 'rejected'])
    const rejected = [a, b].find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toBeInstanceOf(StaleTaskError)
    expect(
      (
        await itemsFor(
          (
            await query<{ run_id: string }>('select run_id from ops_task_items where id = $1', [
              till.id,
            ])
          )[0]!.run_id,
        )
      )[0]!.status,
    ).toBe('awaiting_verification')
    expect((await eventActions(till.id)).filter((e) => e === 'submitted')).toHaveLength(1)
  })

  it('verifies, sends back and reopens only with the right capability, at the right place', async () => {
    const { sam, marcus, items } = await shiftWithWork(35, [
      { title: 'Count the till', requiresVerification: true },
      { title: 'Mop the bar', requiresVerification: false },
    ])
    const [till, mop] = items
    const now = new Date(till!.due_at.getTime() - HOUR)
    await asTenant(harborId, (tx) =>
      completeTask(tx, sam, till!.id, { revision: till!.revision }, now),
    )
    await asTenant(harborId, (tx) =>
      completeTask(tx, sam, mop!.id, { revision: mop!.revision }, now),
    )
    const rev = async (id: string) =>
      (
        await query<{ revision: number }>('select revision from ops_task_items where id = $1', [id])
      )[0]!.revision

    const tess = await harbor.gmDowntown()
    const omar = await harbor.scheduler()
    const jordan = await harbor.lead()
    await expect(
      asTenant(harborId, async (tx) =>
        verifyTask(tx, tess, till!.id, { revision: await rev(till!.id) }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      asTenant(harborId, async (tx) =>
        verifyTask(tx, omar, till!.id, { revision: await rev(till!.id) }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      asTenant(harborId, async (tx) =>
        verifyTask(tx, sam, till!.id, { revision: await rev(till!.id) }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError)

    // Simultaneous verification: one wins.
    const r = await rev(till!.id)
    const results = await Promise.allSettled([
      asTenant(harborId, (tx) => verifyTask(tx, jordan, till!.id, { revision: r })),
      asTenant(harborId, (tx) => verifyTask(tx, marcus, till!.id, { revision: r })),
    ])
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1)

    // A shift lead may send back, but not reopen.
    await expect(
      asTenant(harborId, async (tx) =>
        reopenTask(tx, jordan, mop!.id, { revision: await rev(mop!.id), note: '' }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await asTenant(harborId, async (tx) =>
      returnTask(tx, jordan, mop!.id, {
        revision: await rev(mop!.id),
        note: 'Behind the ice well too.',
      }),
    )
    const [returned] = await query<{
      status: string
      returned_note: string
      completed_at: Date | null
    }>('select status, returned_note, completed_at from ops_task_items where id = $1', [mop!.id])
    expect(returned).toMatchObject({
      status: 'pending',
      returned_note: 'Behind the ice well too.',
      completed_at: null,
    })
    const [told] = await query<{ n: string }>(
      `select count(*) as n from notifications where subject_id = $1 and employment_id = $2`,
      [mop!.id, sam.employmentId],
    )
    expect(Number(told!.n)).toBe(1)

    // Somebody verifying their own work is refused.
    const self = await shiftWithWork(36, [
      { title: 'Close the register', requiresVerification: true },
    ])
    const jordanWork = self.items[0]!
    await asTenant(harborId, (tx) =>
      reassignTask(tx, self.marcus, jordanWork.id, {
        revision: jordanWork.revision,
        toEmploymentId: jordan.employmentId,
        note: '',
      }),
    )
    const jordanRev = await rev(jordanWork.id)
    // Jordan has no shift that day, so it is theirs only by assignment.
    await asTenant(harborId, (tx) =>
      completeTask(
        tx,
        jordan,
        jordanWork.id,
        { revision: jordanRev },
        new Date(jordanWork.due_at.getTime() - HOUR),
      ),
    )
    await expect(
      asTenant(harborId, async (tx) =>
        verifyTask(tx, jordan, jordanWork.id, { revision: await rev(jordanWork.id) }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await asTenant(harborId, async (tx) =>
      verifyTask(tx, self.marcus, jordanWork.id, { revision: await rev(jordanWork.id) }),
    )
    expect(await eventActions(jordanWork.id)).toEqual(
      expect.arrayContaining(['generated', 'reassigned', 'submitted', 'verified']),
    )
  })

  it('keeps colleagues out of each other’s tasks unless a task is shared', async () => {
    const { ava, items, avaShift, riverside } = await shiftWithWork(37, [
      { title: 'Restock the side station', shared: true },
      { title: 'Close out your tables', shared: false },
    ])
    const [shared, personal] = items
    const now = new Date(shared!.due_at.getTime() - HOUR)
    await expect(
      asTenant(harborId, (tx) =>
        completeTask(tx, ava, personal!.id, { revision: personal!.revision }, now),
      ),
    ).rejects.toBeInstanceOf(NotFoundError)
    await asTenant(harborId, (tx) =>
      completeTask(tx, ava, shared!.id, { revision: shared!.revision }, now),
    )
    const [row] = await query<{ status: string; completed_by_employment_id: string }>(
      'select status, completed_by_employment_id from ops_task_items where id = $1',
      [shared!.id],
    )
    expect(row).toMatchObject({ status: 'done', completed_by_employment_id: ava.employmentId })

    // Ava sees the shared task on her own workspace, but not the personal one.
    const marcus = await harbor.gmRiverside()
    const { templateId: other } = await publishedTemplate(harborId, marcus, {
      name: unique('Shared restock'),
      locationIds: [riverside],
      tasks: [{ title: 'Refill the ice bins', shared: true }],
    })
    void other
    const work = await asTenant(harborId, (tx) =>
      getMyShiftWork(tx, ava, { shiftId: avaShift.shiftId, now }),
    )
    expect(work!.teamTasks.map((t) => t.id)).not.toContain(personal!.id)
  })

  it('asks for reasons, allows an honest undo, and opens work only near the shift', async () => {
    const { sam, items } = await shiftWithWork(38, [
      { title: 'Change the fryer oil' },
      { title: 'Deep clean the hood' },
      { title: 'Temperature log', responseType: 'number' },
      { title: 'Leave a handoff', responseType: 'handoff' },
    ])
    const [oil, hood, temp, handoff] = items
    const start = oil!.due_at

    await expect(
      asTenant(harborId, (tx) =>
        completeTask(
          tx,
          sam,
          oil!.id,
          { revision: oil!.revision },
          new Date(start.getTime() - 13 * HOUR),
        ),
      ),
    ).rejects.toBeInstanceOf(ValidationError)

    const now = new Date(start.getTime() - HOUR)
    await expect(
      asTenant(harborId, (tx) =>
        skipTask(tx, sam, hood!.id, { revision: hood!.revision, reason: '  ' }, now),
      ),
    ).rejects.toBeInstanceOf(ValidationError)
    await asTenant(harborId, (tx) =>
      skipTask(
        tx,
        sam,
        hood!.id,
        { revision: hood!.revision, reason: 'Hood contractor comes Friday.' },
        now,
      ),
    )
    await asTenant(harborId, (tx) =>
      blockTask(tx, sam, oil!.id, { revision: oil!.revision, reason: 'No oil delivered.' }, now),
    )
    await expect(
      asTenant(harborId, (tx) =>
        completeTask(tx, sam, temp!.id, { revision: temp!.revision, number: 'cold' }, now),
      ),
    ).rejects.toBeInstanceOf(ValidationError)
    await asTenant(harborId, (tx) =>
      completeTask(tx, sam, temp!.id, { revision: temp!.revision, number: '38.5' }, now),
    )
    const [log] = await query<{ response_number: string }>(
      'select response_number from ops_task_items where id = $1',
      [temp!.id],
    )
    expect(log!.response_number).toBe('38.50')

    const tempRev = (
      await query<{ revision: number }>('select revision from ops_task_items where id = $1', [
        temp!.id,
      ])
    )[0]!.revision
    await asTenant(harborId, (tx) => undoTask(tx, sam, temp!.id, { revision: tempRev }, now))
    expect(
      (
        await query<{ status: string }>('select status from ops_task_items where id = $1', [
          temp!.id,
        ])
      )[0]!.status,
    ).toBe('pending')

    await asTenant(harborId, (tx) =>
      completeHandoffTask(
        tx,
        sam,
        handoff!.id,
        {
          revision: handoff!.revision,
          nothingToHandOver: false,
          category: 'inventory',
          priority: 'urgent',
          title: 'Fryer oil not delivered',
          body: 'Called the supplier at 9:40 PM.',
        },
        now,
      ),
    )
    const [linked] = await query<{ handoff_id: string; status: string }>(
      'select handoff_id, status from ops_task_items where id = $1',
      [handoff!.id],
    )
    expect(linked!.status).toBe('done')
    const [record] = await query<{ category: string; author_employment_id: string }>(
      'select category, author_employment_id from handoffs where id = $1',
      [linked!.handoff_id],
    )
    expect(record).toEqual({ category: 'inventory', author_employment_id: sam.employmentId })
  })
})

describe('handoffs', () => {
  it('reach the people who work there, and only managers resolve them', async () => {
    const riverside = await location(harborId, 'Riverside')
    const marcus = await harbor.gmRiverside()
    const sam = await harbor.sam()
    const ava = await harbor.ava()
    const tess = await harbor.gmDowntown()
    const jordan = await harbor.lead()
    const date = dateIn(39, 4)
    const { shiftId, scheduleId } = await makeShift(
      harborId,
      marcus,
      riverside,
      date,
      '16:00',
      '22:00',
      sam.employmentId,
    )
    await publish(harborId, marcus, scheduleId)

    const handoffId = await asTenant(harborId, (tx) =>
      createHandoff(tx, sam, {
        locationId: riverside,
        shiftId,
        category: 'maintenance',
        priority: 'normal',
        title: 'Walk-in door sticks',
        body: 'Lift the handle to close it.',
      }),
    )
    // Without a shift, only a manager may leave one.
    await expect(
      asTenant(harborId, (tx) =>
        createHandoff(tx, sam, {
          locationId: riverside,
          shiftId: null,
          category: 'safety',
          priority: 'normal',
          title: 'x',
          body: '',
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError)

    await asTenant(harborId, (tx) => acknowledgeHandoff(tx, ava, handoffId))
    await asTenant(harborId, (tx) => acknowledgeHandoff(tx, ava, handoffId))
    await expect(
      asTenant(harborId, (tx) => acknowledgeHandoff(tx, tess, handoffId)),
    ).rejects.toBeInstanceOf(NotFoundError)
    const [acks] = await query<{ n: string }>(
      'select count(*) as n from handoff_acknowledgements where handoff_id = $1',
      [handoffId],
    )
    expect(Number(acks!.n)).toBe(1)

    await expect(
      asTenant(harborId, (tx) => resolveHandoff(tx, sam, handoffId, 'Fixed')),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await asTenant(harborId, (tx) => resolveHandoff(tx, jordan, handoffId, 'Hinge replaced.'))
    await expect(
      asTenant(harborId, (tx) => resolveHandoff(tx, jordan, handoffId, 'Again')),
    ).rejects.toBeInstanceOf(ValidationError)
    await asTenant(harborId, (tx) => reopenHandoff(tx, marcus, handoffId))
    const audit = await query<{ action: string; metadata: { previousResolutionNote?: string } }>(
      `select action, metadata from audit_events where subject_id = $1 order by created_at`,
      [handoffId],
    )
    expect(audit.map((a) => a.action)).toEqual([
      'handoff.created',
      'handoff.resolved',
      'handoff.reopened',
    ])
    expect(audit[2]!.metadata.previousResolutionNote).toBe('Hinge replaced.')
  })
})

describe('boundaries', () => {
  it('lands an overnight shift in a second timezone on its local business date', async () => {
    const bench = await location(lumenId, 'Boise Bench')
    const ana = await lumen.owner()
    const ruben = await lumen.ruben()
    const { templateId } = await publishedTemplate(lumenId, ana, {
      name: unique('Late closing'),
      kind: 'closing',
      locationIds: [bench],
      tasks: [{ title: 'Run the towel laundry', timingAnchor: 'shift_end', offsetMinutes: -30 }],
    })
    const date = dateIn(40, 5, 'America/Denver')
    const { shiftId, scheduleId } = await makeShift(
      lumenId,
      ana,
      bench,
      date,
      '20:00',
      '02:00',
      ruben.employmentId,
    )
    await publish(lumenId, ana, scheduleId)
    const [run] = await runsFor(shiftId, templateId)
    expect(run!.business_date).toBe(date)
    const [item] = await itemsFor(run!.id)
    expect(localDateOf(item!.due_at, 'America/Denver')).toBe(addCalendarDays(date, 1))

    const board = await asTenant(lumenId, (tx) =>
      getBoard(tx, ana, {
        locationId: bench,
        date,
        now: new Date(item!.due_at.getTime() - 5 * HOUR),
      }),
    )
    const onBoard = board.shifts.flatMap((s) => s.items).find((i) => i.id === item!.id)
    expect(onBoard!.dueLabel).toBe('1:30 AM (next day)')
    expect(board.location.timeZone).toBe('America/Denver')
  })

  it('keeps tenants and locations apart, and refuses silent deletion', async () => {
    const riverside = await location(harborId, 'Riverside')
    const marcus = await harbor.gmRiverside()
    const sam = await harbor.sam()
    const { templateId } = await publishedTemplate(harborId, marcus, {
      name: unique('Isolation'),
      locationIds: [riverside],
      tasks: [{ title: 'Something' }],
    })
    const date = dateIn(41, 4)
    const { shiftId, scheduleId } = await makeShift(
      harborId,
      marcus,
      riverside,
      date,
      '16:00',
      '22:00',
      sam.employmentId,
    )
    await publish(harborId, marcus, scheduleId)
    const [run] = await runsFor(shiftId, templateId)
    const [item] = await itemsFor(run!.id)

    // Another tenant's session sees none of it.
    const seen = await rawAsApp(
      lumenId,
      'select count(*)::int as n from ops_task_items where id = $1',
      [item!.id],
    )
    expect(seen.rows[0].n).toBe(0)
    const ana = await lumen.owner()
    await expect(
      asTenant(lumenId, (tx) => verifyTask(tx, ana, item!.id, { revision: item!.revision })),
    ).rejects.toBeInstanceOf(NotFoundError)
    // An employee has no board; a manager elsewhere cannot open this location's.
    await expect(
      asTenant(harborId, (tx) => getBoard(tx, sam, { locationId: riverside })),
    ).rejects.toBeInstanceOf(NotFoundError)
    const tess = await harbor.gmDowntown()
    await expect(
      asTenant(harborId, (tx) => getBoard(tx, tess, { locationId: riverside })),
    ).rejects.toBeInstanceOf(NotFoundError)

    // History is append-only and nothing is deleted by the application.
    expect(
      await codeOf(rawAsApp(harborId, 'delete from ops_task_items where id = $1', [item!.id])),
    ).toBe('42501')
    expect(await codeOf(rawAsApp(harborId, 'delete from ops_runs where id = $1', [run!.id]))).toBe(
      '42501',
    )
    expect(
      await codeOf(
        rawAsApp(harborId, `update ops_task_events set note = 'x' where item_id = $1`, [item!.id]),
      ),
    ).toBe('42501')
    expect(
      await codeOf(
        rawAsApp(harborId, 'delete from ops_task_events where item_id = $1', [item!.id]),
      ),
    ).toBe('42501')
    expect(await codeOf(rawAsApp(harborId, 'delete from handoffs'))).toBe('42501')
    expect(
      await codeOf(
        rawAsApp(harborId, 'delete from ops_run_assignees where run_id = $1', [run!.id]),
      ),
    ).toBe('42501')
  })
})
