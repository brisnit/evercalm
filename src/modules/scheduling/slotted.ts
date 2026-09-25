import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { newId } from '@/lib/ids'
import { NotFoundError, ValidationError } from '@/lib/errors'
import type { Tx } from '@/server/db'
import type { Actor } from '@/server/authz/actor'
import { AUDIT_ACTIONS, recordAuditEvent } from '@/server/audit'
import { employments, jobRoles } from '@/server/db/schema'
import {
  scheduleDayReviews,
  scheduleOverrides,
  scheduleTemplates,
  shiftCallouts,
  shiftTemplates,
  shifts,
} from './schema'
import { ensureSchedule, markChanged, requireWeekStart, weekBounds } from './service'
import { requireLocation, requireLocationCapability } from './access'
import { loadConflictPeople, listSchedulablePeople, conflictShift } from './people'
import { detectConflicts, hasBlockingConflict } from './conflicts'
import {
  availabilityStateFor,
  AVAILABILITY_RANK,
  type AvailabilityState,
} from './availability-state'
import { formatShift, isoWeekday, localDateOf, paidMinutes, shiftInstants, weekDates } from './time'
import { schedules } from './schema'

/**
 * SLOTTED - manager scheduling, round 2.
 *
 * Describe demand once, generate the week's slots, fill them, review one day
 * at a time, publish. The model underneath is the one that was already here:
 * a SLOT is a `shifts` row with nobody in it, a named week is a
 * `schedule_templates` row with `shift_templates` pointing at it, and draft
 * versus published is `schedules.status`.
 *
 * Four rules this module exists to keep:
 *
 *   1. Approved time off is never assignable. Not with a warning, not with a
 *      confirmation: `assignToSlot` refuses it, because there is no interface
 *      anywhere that should be able to produce it.
 *   2. Declared unavailability warns and can be overridden - and the override
 *      is recorded with the manager's name, shown again before publishing, and
 *      shown to the person on their own schedule.
 *   3. Autofill never publishes. It produces a draft the manager owns, and it
 *      explains every choice it made.
 *   4. A one-off edit never changes the template. Editing a generated shift
 *      touches the shift.
 */

// ---------------------------------------------------------------------------
// Named weeks (the template wizard)
// ---------------------------------------------------------------------------

export interface PatternInput {
  name: string
  jobRoleId: string | null
  startMinute: number
  endMinute: number
  headcount: number
  daysOfWeek: number[]
}

export interface TemplateSetInput {
  name: string
  openDays: number[]
  mealMinutes: number
  mealAfterMinutes: number
  restMinutes: number
  restEveryMinutes: number
  staggerBreaks: boolean
  patterns: PatternInput[]
}

export interface TemplateSetSummary {
  id: string
  name: string
  isDefault: boolean
  openDays: number[]
  patterns: number
  slotsPerWeek: number
  weeklyMinutes: number
  updatedAt: Date
}

export async function listTemplateSets(
  tx: Tx,
  actor: Actor,
  locationId: string,
): Promise<TemplateSetSummary[]> {
  const sets = await tx
    .select()
    .from(scheduleTemplates)
    .where(
      and(
        eq(scheduleTemplates.organizationId, actor.organizationId),
        eq(scheduleTemplates.locationId, locationId),
        isNull(scheduleTemplates.archivedAt),
      ),
    )
    .orderBy(asc(scheduleTemplates.createdAt))
  if (sets.length === 0) return []

  const patterns = await tx
    .select()
    .from(shiftTemplates)
    .where(
      and(
        eq(shiftTemplates.organizationId, actor.organizationId),
        inArray(
          shiftTemplates.templateSetId,
          sets.map((s) => s.id),
        ),
        isNull(shiftTemplates.archivedAt),
      ),
    )

  return sets.map((set) => {
    const mine = patterns.filter((p) => p.templateSetId === set.id)
    let slots = 0
    let minutes = 0
    for (const pattern of mine) {
      const days = pattern.daysOfWeek.filter((d) => set.openDays.includes(d))
      const length =
        pattern.endMinute > pattern.startMinute
          ? pattern.endMinute - pattern.startMinute
          : 1440 - pattern.startMinute + pattern.endMinute
      slots += days.length * pattern.headcount
      minutes += days.length * pattern.headcount * length
    }
    return {
      id: set.id,
      name: set.name,
      isDefault: set.isDefault,
      openDays: set.openDays,
      patterns: mine.length,
      slotsPerWeek: slots,
      weeklyMinutes: minutes,
      updatedAt: set.updatedAt,
    }
  })
}

export async function getTemplateSet(tx: Tx, actor: Actor, templateSetId: string) {
  const [set] = await tx
    .select()
    .from(scheduleTemplates)
    .where(
      and(
        eq(scheduleTemplates.organizationId, actor.organizationId),
        eq(scheduleTemplates.id, templateSetId),
      ),
    )
    .limit(1)
  if (!set) throw new NotFoundError('Template not found')

  const patterns = await tx
    .select({
      id: shiftTemplates.id,
      name: shiftTemplates.name,
      jobRoleId: shiftTemplates.jobRoleId,
      jobRoleName: jobRoles.name,
      startMinute: shiftTemplates.startMinute,
      endMinute: shiftTemplates.endMinute,
      headcount: shiftTemplates.headcount,
      daysOfWeek: shiftTemplates.daysOfWeek,
      breakMinutes: shiftTemplates.breakMinutes,
    })
    .from(shiftTemplates)
    .leftJoin(
      jobRoles,
      and(
        eq(jobRoles.organizationId, shiftTemplates.organizationId),
        eq(jobRoles.id, shiftTemplates.jobRoleId),
      ),
    )
    .where(
      and(
        eq(shiftTemplates.organizationId, actor.organizationId),
        eq(shiftTemplates.templateSetId, templateSetId),
        isNull(shiftTemplates.archivedAt),
      ),
    )
    .orderBy(asc(shiftTemplates.startMinute))

  return { ...set, patterns }
}

export async function createTemplateSet(
  tx: Tx,
  actor: Actor,
  locationId: string,
  input: TemplateSetInput,
): Promise<string> {
  const location = await requireLocationCapability(
    tx,
    actor,
    locationId,
    'schedule.manage_templates',
  )

  const name = input.name.trim()
  if (!name) throw new ValidationError({ name: ['Give the template a name'] })
  if (name.length > 80) throw new ValidationError({ name: ['That name is too long'] })
  if (input.openDays.length === 0) {
    throw new ValidationError({ openDays: ['Open at least one day'] })
  }
  if (input.patterns.length === 0) {
    throw new ValidationError({ patterns: ['Add at least one shift'] })
  }

  const [clash] = await tx
    .select({ id: scheduleTemplates.id })
    .from(scheduleTemplates)
    .where(
      and(
        eq(scheduleTemplates.organizationId, actor.organizationId),
        eq(scheduleTemplates.locationId, locationId),
        eq(scheduleTemplates.name, name),
        isNull(scheduleTemplates.archivedAt),
      ),
    )
    .limit(1)
  if (clash) throw new ValidationError({ name: ['A template here already has that name'] })

  const [existing] = await tx
    .select({ id: scheduleTemplates.id })
    .from(scheduleTemplates)
    .where(
      and(
        eq(scheduleTemplates.organizationId, actor.organizationId),
        eq(scheduleTemplates.locationId, locationId),
        isNull(scheduleTemplates.archivedAt),
      ),
    )
    .limit(1)

  const id = newId()
  await tx.insert(scheduleTemplates).values({
    id,
    organizationId: actor.organizationId,
    locationId,
    name,
    // The first template a location makes is the one a new week starts from.
    isDefault: !existing,
    openDays: input.openDays,
    mealMinutes: input.mealMinutes,
    mealAfterMinutes: input.mealAfterMinutes,
    restMinutes: input.restMinutes,
    restEveryMinutes: input.restEveryMinutes,
    staggerBreaks: input.staggerBreaks,
    createdByEmploymentId: actor.employmentId,
  })

  for (const pattern of input.patterns) {
    if (pattern.headcount < 1 || pattern.headcount > 50) {
      throw new ValidationError({ patterns: ['Headcount must be between 1 and 50'] })
    }
    const length =
      pattern.endMinute > pattern.startMinute
        ? pattern.endMinute - pattern.startMinute
        : 1440 - pattern.startMinute + pattern.endMinute
    await tx.insert(shiftTemplates).values({
      id: newId(),
      organizationId: actor.organizationId,
      locationId,
      templateSetId: id,
      name: pattern.name.trim() || 'Shift',
      jobRoleId: pattern.jobRoleId,
      startMinute: pattern.startMinute,
      endMinute: pattern.endMinute,
      // Breaks are a property of the named week, applied to every shift in it.
      breakMinutes: length >= input.mealAfterMinutes ? input.mealMinutes : 0,
      daysOfWeek: pattern.daysOfWeek.filter((d) => input.openDays.includes(d)),
      headcount: pattern.headcount,
      createdByEmploymentId: actor.employmentId,
    })
  }

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.SHIFT_TEMPLATE_CREATED,
    summary: `Created the schedule template "${name}" for ${location.name}`,
    subjectType: 'schedule_template',
    subjectId: id,
    locationId,
    metadata: { patterns: input.patterns.length, openDays: input.openDays },
  })

  return id
}

export async function archiveTemplateSet(
  tx: Tx,
  actor: Actor,
  templateSetId: string,
): Promise<void> {
  const set = await getTemplateSet(tx, actor, templateSetId)
  await requireLocationCapability(tx, actor, set.locationId, 'schedule.manage_templates')
  const now = new Date()
  await tx
    .update(shiftTemplates)
    .set({ archivedAt: now })
    .where(
      and(
        eq(shiftTemplates.organizationId, actor.organizationId),
        eq(shiftTemplates.templateSetId, templateSetId),
      ),
    )
  await tx
    .update(scheduleTemplates)
    .set({ archivedAt: now })
    .where(
      and(
        eq(scheduleTemplates.organizationId, actor.organizationId),
        eq(scheduleTemplates.id, templateSetId),
      ),
    )
}

// ---------------------------------------------------------------------------
// Generate the week
// ---------------------------------------------------------------------------

/**
 * Lay out every slot the template asks for, for one week.
 *
 * Nobody is assigned: the point of the model is that a manager describes
 * demand once and only ever chooses people. Running it twice does not
 * duplicate anything - it tops each day up to the headcount the template
 * asks for, which is also what makes it safe after a manual edit.
 */
export async function generateWeek(
  tx: Tx,
  actor: Actor,
  input: { locationId: string; weekStart: string; templateSetId: string },
): Promise<{ scheduleId: string; created: number; slots: number }> {
  const location = await requireLocationCapability(tx, actor, input.locationId, 'schedule.draft')
  requireWeekStart(input.weekStart)
  const set = await getTemplateSet(tx, actor, input.templateSetId)
  if (set.locationId !== input.locationId) {
    throw new ValidationError({ templateSetId: ['That template is for another location'] })
  }

  const schedule = await ensureSchedule(tx, actor, location, input.weekStart)
  const existing = await tx
    .select({ templateId: shifts.templateId, startsAt: shifts.startsAt })
    .from(shifts)
    .where(
      and(
        eq(shifts.organizationId, actor.organizationId),
        eq(shifts.scheduleId, schedule.id),
        eq(shifts.status, 'active'),
      ),
    )

  let created = 0
  for (const pattern of set.patterns) {
    for (const date of weekDates(input.weekStart)) {
      const weekday = isoWeekday(date)
      if (!set.openDays.includes(weekday)) continue
      if (!pattern.daysOfWeek.includes(weekday)) continue
      const times = shiftInstants(date, pattern.startMinute, pattern.endMinute, location.timeZone)
      // A time that does not exist on a clock-change date is skipped, not moved.
      if (!times.ok) continue
      const already = existing.filter(
        (s) => s.templateId === pattern.id && localDateOf(s.startsAt, location.timeZone) === date,
      ).length
      for (let i = already; i < pattern.headcount; i += 1) {
        await tx.insert(shifts).values({
          id: newId(),
          organizationId: actor.organizationId,
          scheduleId: schedule.id,
          locationId: input.locationId,
          templateId: pattern.id,
          jobRoleId: pattern.jobRoleId,
          startsAt: times.startsAt,
          endsAt: times.endsAt,
          breakMinutes: pattern.breakMinutes,
          createdByEmploymentId: actor.employmentId,
          updatedByEmploymentId: actor.employmentId,
        })
        created += 1
      }
    }
  }

  const [total] = await tx
    .select({ count: sql<number>`count(*)` })
    .from(shifts)
    .where(
      and(
        eq(shifts.organizationId, actor.organizationId),
        eq(shifts.scheduleId, schedule.id),
        eq(shifts.status, 'active'),
      ),
    )

  if (created > 0) {
    await markChanged(tx, actor.organizationId, schedule.id)
    await recordAuditEvent(tx, actor, {
      action: AUDIT_ACTIONS.SHIFT_TEMPLATE_APPLIED,
      summary: `Generated ${created} slots for ${location.name} from "${set.name}"`,
      subjectType: 'schedule',
      subjectId: schedule.id,
      locationId: input.locationId,
      metadata: { created, templateSet: set.name },
    })
  }

  return { scheduleId: schedule.id, created, slots: Number(total?.count ?? 0) }
}

// ---------------------------------------------------------------------------
// Filling a slot
// ---------------------------------------------------------------------------

export interface Candidate {
  employmentId: string
  displayName: string
  state: AvailabilityState
  /** Why they are where they are, in the manager's words. */
  reason: string
  /** Paid minutes already on their week, before this shift. */
  weekMinutes: number
  /** Their week if they take it. */
  wouldBeMinutes: number
  overtime: boolean
  /** A real conflict - already working, wrong location, inactive. */
  blocked: boolean
  blockedReason: string | null
  hasJobRole: boolean
}

const OVERTIME_MINUTES = 40 * 60

async function slotContext(tx: Tx, actor: Actor, shiftId: string) {
  const [shift] = await tx
    .select()
    .from(shifts)
    .where(and(eq(shifts.organizationId, actor.organizationId), eq(shifts.id, shiftId)))
    .limit(1)
  if (!shift) throw new NotFoundError('Shift not found')

  const [schedule] = await tx
    .select()
    .from(schedules)
    .where(
      and(eq(schedules.organizationId, actor.organizationId), eq(schedules.id, shift.scheduleId)),
    )
    .limit(1)
  if (!schedule) throw new NotFoundError('Schedule not found')

  const location = await requireLocation(tx, actor.organizationId, shift.locationId)
  return { shift, schedule, location }
}

/**
 * Everyone who could take this slot, grouped the way a manager decides.
 *
 * Available first, then not preferred, then unavailable, then approved time
 * off - which is listed, not hidden, and locked. Within a group the person
 * with the fewest hours comes first, because the next question after "can
 * they" is always "should they".
 */
export async function candidatesForSlot(
  tx: Tx,
  actor: Actor,
  shiftId: string,
): Promise<{ candidates: Candidate[]; roleName: string | null }> {
  const { shift, schedule, location } = await slotContext(tx, actor, shiftId)
  await requireLocationCapability(tx, actor, shift.locationId, 'schedule.draft')

  const people = await listSchedulablePeople(tx, actor.organizationId, shift.locationId)
  const { from, to } = weekBounds(location, schedule.weekStart)
  const context = await loadConflictPeople(
    tx,
    actor.organizationId,
    people.map((p) => p.employmentId),
    { from, to },
  )

  const shape = conflictShift(shift, location.timeZone)
  const out: Candidate[] = []

  for (const person of people) {
    const full = context.get(person.employmentId)
    if (!full) continue
    const state = availabilityStateFor(shape, full)
    const conflicts = detectConflicts(shape, full)
    const blocking = conflicts.filter(
      (c) => c.severity === 'block' && c.kind !== 'time_off_approved',
    )

    const weekMinutes = full.shifts
      .filter((s) => s.id !== shift.id && s.startsAt >= from && s.startsAt < to)
      .reduce((sum, s) => sum + paidMinutes(s.startsAt, s.endsAt, s.breakMinutes), 0)
    const wouldBe = weekMinutes + paidMinutes(shift.startsAt, shift.endsAt, shift.breakMinutes)

    out.push({
      employmentId: person.employmentId,
      displayName: person.displayName,
      state,
      reason: reasonFor(state, conflicts, person.displayName),
      weekMinutes,
      wouldBeMinutes: wouldBe,
      overtime: wouldBe > OVERTIME_MINUTES,
      blocked: blocking.length > 0,
      blockedReason: blocking[0]?.message ?? null,
      hasJobRole: !shift.jobRoleId || person.jobRoleIds.includes(shift.jobRoleId),
    })
  }

  // Role-qualified people first: a slot asks for a job, not just a body.
  out.sort(
    (a, b) =>
      Number(b.hasJobRole) - Number(a.hasJobRole) ||
      Number(a.blocked) - Number(b.blocked) ||
      AVAILABILITY_RANK[a.state] - AVAILABILITY_RANK[b.state] ||
      a.weekMinutes - b.weekMinutes ||
      a.displayName.localeCompare(b.displayName),
  )

  const roleName = shift.jobRoleId
    ? ((
        await tx
          .select({ name: jobRoles.name })
          .from(jobRoles)
          .where(
            and(
              eq(jobRoles.organizationId, actor.organizationId),
              eq(jobRoles.id, shift.jobRoleId),
            ),
          )
          .limit(1)
      )[0]?.name ?? null)
    : null

  return { candidates: out, roleName }
}

function reasonFor(
  state: AvailabilityState,
  conflicts: { kind: string; severity: string; message: string }[],
  name: string,
): string {
  const first = name.split(' ')[0] ?? name
  if (state === 'time_off') return `${first} has approved time off. There is no override.`
  const overlap = conflicts.find((c) => c.kind === 'overlap')
  if (overlap) return `Already on another shift at this time.`
  if (state === 'unavailable') return `${first} said they cannot work these hours.`
  if (state === 'not_preferred') return `${first} can work it, but would rather not.`
  return `${first} is free and prefers these hours.`
}

/**
 * Put somebody in a slot.
 *
 * Approved time off is refused outright - not warned about, refused, because
 * no interface should be able to produce it. Declared unavailability is
 * allowed only when the manager says so explicitly, and then it is recorded
 * with their name against it.
 */
export async function assignToSlot(
  tx: Tx,
  actor: Actor,
  shiftId: string,
  employmentId: string,
  options: { overrideUnavailable?: boolean; reason?: string } = {},
): Promise<{ overridden: boolean }> {
  const { shift, schedule, location } = await slotContext(tx, actor, shiftId)
  await requireLocationCapability(tx, actor, shift.locationId, 'schedule.draft')

  const { from, to } = weekBounds(location, schedule.weekStart)
  const context = await loadConflictPeople(tx, actor.organizationId, [employmentId], { from, to })
  const person = context.get(employmentId)
  if (!person) throw new NotFoundError('Employee not found')

  const shape = conflictShift(shift, location.timeZone)
  const state = availabilityStateFor(shape, person)

  if (state === 'time_off') {
    throw new ValidationError({
      employmentId: [
        `${person.displayName} has approved time off for this shift. Change the time-off request first — it cannot be overridden here.`,
      ],
    })
  }

  const conflicts = detectConflicts(shape, person)
  if (hasBlockingConflict(conflicts)) {
    throw new ValidationError({
      employmentId: [conflicts.find((c) => c.severity === 'block')!.message],
    })
  }

  if (state === 'unavailable' && !options.overrideUnavailable) {
    throw new ValidationError({
      employmentId: [
        `${person.displayName} said they are unavailable for this shift. You can schedule them anyway, and they will see that you did.`,
      ],
    })
  }

  await tx
    .update(shifts)
    .set({
      assigneeEmploymentId: employmentId,
      isOpen: false,
      version: shift.version + 1,
      updatedByEmploymentId: actor.employmentId,
      updatedAt: new Date(),
    })
    .where(and(eq(shifts.organizationId, actor.organizationId), eq(shifts.id, shiftId)))

  // A fresh decision replaces whatever was recorded for this slot before.
  await tx
    .delete(scheduleOverrides)
    .where(
      and(
        eq(scheduleOverrides.organizationId, actor.organizationId),
        eq(scheduleOverrides.shiftId, shiftId),
      ),
    )

  if (state === 'unavailable') {
    await tx.insert(scheduleOverrides).values({
      id: newId(),
      organizationId: actor.organizationId,
      scheduleId: shift.scheduleId,
      shiftId,
      employmentId,
      kind: 'unavailable',
      reason: options.reason?.trim() ?? '',
      decidedByEmploymentId: actor.employmentId,
    })
  }

  await markChanged(tx, actor.organizationId, shift.scheduleId)
  // Assigning someone changes the day, so it needs looking at again.
  await clearDayReview(tx, actor, shift.scheduleId, localDateOf(shift.startsAt, location.timeZone))

  return { overridden: state === 'unavailable' }
}

export async function clearSlot(tx: Tx, actor: Actor, shiftId: string): Promise<void> {
  const { shift, location } = await slotContext(tx, actor, shiftId)
  await requireLocationCapability(tx, actor, shift.locationId, 'schedule.draft')

  await tx
    .update(shifts)
    .set({
      assigneeEmploymentId: null,
      version: shift.version + 1,
      updatedByEmploymentId: actor.employmentId,
      updatedAt: new Date(),
    })
    .where(and(eq(shifts.organizationId, actor.organizationId), eq(shifts.id, shiftId)))

  await tx
    .delete(scheduleOverrides)
    .where(
      and(
        eq(scheduleOverrides.organizationId, actor.organizationId),
        eq(scheduleOverrides.shiftId, shiftId),
      ),
    )

  await markChanged(tx, actor.organizationId, shift.scheduleId)
  await clearDayReview(tx, actor, shift.scheduleId, localDateOf(shift.startsAt, location.timeZone))
}

// ---------------------------------------------------------------------------
// Autofill
// ---------------------------------------------------------------------------

export interface AutofillResult {
  filled: number
  total: number
  /** One plain-English line per thing the manager should know. */
  explanation: {
    kind: 'preferred' | 'not_preferred' | 'time_off' | 'overtime' | 'breaks' | 'open'
    headline: string
    detail: string
  }[]
  /** Why each person got each shift, for "why Mike on Monday morning?". */
  picks: { shiftId: string; employmentId: string; displayName: string; reasons: string[] }[]
}

/**
 * Propose a person for every empty slot, and say how it decided.
 *
 * Deliberately simple and deliberately explainable: walk the week in order,
 * and for each empty slot take the role-qualified person who is free, prefers
 * those hours if anyone does, and has the fewest hours so far. It never picks
 * somebody on approved time off, never picks somebody who said they are
 * unavailable, and never pushes anybody over forty hours.
 *
 * NOTHING IS PUBLISHED. Every pick is a draft the manager can change, which is
 * why the result carries its reasoning rather than just a number.
 */
export async function autofillWeek(
  tx: Tx,
  actor: Actor,
  scheduleId: string,
): Promise<AutofillResult> {
  const [schedule] = await tx
    .select()
    .from(schedules)
    .where(and(eq(schedules.organizationId, actor.organizationId), eq(schedules.id, scheduleId)))
    .limit(1)
  if (!schedule) throw new NotFoundError('Schedule not found')
  const location = await requireLocationCapability(tx, actor, schedule.locationId, 'schedule.draft')

  const rows = await tx
    .select()
    .from(shifts)
    .where(
      and(
        eq(shifts.organizationId, actor.organizationId),
        eq(shifts.scheduleId, scheduleId),
        eq(shifts.status, 'active'),
      ),
    )
    .orderBy(asc(shifts.startsAt))

  const people = await listSchedulablePeople(tx, actor.organizationId, schedule.locationId)
  const { from, to } = weekBounds(location, schedule.weekStart)
  const context = await loadConflictPeople(
    tx,
    actor.organizationId,
    people.map((p) => p.employmentId),
    { from, to },
  )

  // Minutes and taken windows are tracked in memory as we go, so the second
  // slot of a shift never offers somebody we just placed in the first.
  const minutes = new Map<string, number>()
  const taken = new Map<string, { startsAt: Date; endsAt: Date }[]>()
  for (const person of people) {
    const full = context.get(person.employmentId)
    const own = (full?.shifts ?? []).filter((s) => s.startsAt >= from && s.startsAt < to)
    minutes.set(
      person.employmentId,
      own.reduce((sum, s) => sum + paidMinutes(s.startsAt, s.endsAt, s.breakMinutes), 0),
    )
    taken.set(
      person.employmentId,
      own.map((s) => ({ startsAt: s.startsAt, endsAt: s.endsAt })),
    )
  }

  const picks: AutofillResult['picks'] = []
  const notPreferred: string[] = []
  const timeOffRespected = new Set<string>()
  let preferredCount = 0
  let filled = 0
  const openSlots: string[] = []

  for (const shift of rows) {
    if (shift.assigneeEmploymentId) continue
    const shape = conflictShift(shift, location.timeZone)
    const shiftMinutes = paidMinutes(shift.startsAt, shift.endsAt, shift.breakMinutes)

    type Ranked = { person: (typeof people)[number]; state: AvailabilityState; so_far: number }
    const ranked: Ranked[] = []

    for (const person of people) {
      const full = context.get(person.employmentId)
      if (!full) continue
      if (shift.jobRoleId && !person.jobRoleIds.includes(shift.jobRoleId)) continue

      const state = availabilityStateFor(shape, full)
      if (state === 'time_off') {
        timeOffRespected.add(person.displayName)
        continue
      }
      // Autofill never overrides a stated no. A manager can, by hand.
      if (state === 'unavailable') continue

      const clash = (taken.get(person.employmentId) ?? []).some(
        (s) => shift.startsAt < s.endsAt && s.startsAt < shift.endsAt,
      )
      if (clash) continue

      const soFar = minutes.get(person.employmentId) ?? 0
      if (soFar + shiftMinutes > OVERTIME_MINUTES) continue

      ranked.push({ person, state, so_far: soFar })
    }

    ranked.sort(
      (a, b) =>
        AVAILABILITY_RANK[a.state] - AVAILABILITY_RANK[b.state] ||
        a.so_far - b.so_far ||
        a.person.displayName.localeCompare(b.person.displayName),
    )

    const chosen = ranked[0]
    if (!chosen) {
      const label = formatShift(shift.startsAt, shift.endsAt, location.timeZone)
      openSlots.push(`${label.day}, ${label.time}`)
      continue
    }

    await tx
      .update(shifts)
      .set({
        assigneeEmploymentId: chosen.person.employmentId,
        isOpen: false,
        version: shift.version + 1,
        updatedByEmploymentId: actor.employmentId,
        updatedAt: new Date(),
      })
      .where(and(eq(shifts.organizationId, actor.organizationId), eq(shifts.id, shift.id)))

    minutes.set(
      chosen.person.employmentId,
      (minutes.get(chosen.person.employmentId) ?? 0) + shiftMinutes,
    )
    taken.set(chosen.person.employmentId, [
      ...(taken.get(chosen.person.employmentId) ?? []),
      { startsAt: shift.startsAt, endsAt: shift.endsAt },
    ])
    filled += 1

    const label = formatShift(shift.startsAt, shift.endsAt, location.timeZone)
    if (chosen.state === 'available') preferredCount += 1
    else notPreferred.push(`${chosen.person.displayName.split(' ')[0]} on ${label.day}`)

    picks.push({
      shiftId: shift.id,
      employmentId: chosen.person.employmentId,
      displayName: chosen.person.displayName,
      reasons: [
        chosen.state === 'available' ? 'Prefers these hours' : 'Can work it, would rather not',
        shift.jobRoleId ? 'Holds the job role' : 'No job role needed',
        `${Math.round(chosen.so_far / 60)} h so far this week`,
        'No time off',
      ],
    })
  }

  const total = rows.length
  const breaks = rows.filter((r) => r.breakMinutes > 0).length

  const explanation: AutofillResult['explanation'] = []
  if (preferredCount > 0) {
    explanation.push({
      kind: 'preferred',
      headline: `${preferredCount} ${preferredCount === 1 ? 'shift' : 'shifts'} inside preferred availability`,
      detail: 'Most people got the hours they asked for.',
    })
  }
  if (notPreferred.length > 0) {
    explanation.push({
      kind: 'not_preferred',
      headline: `${notPreferred.length} not-preferred ${notPreferred.length === 1 ? 'shift' : 'shifts'}`,
      detail: notPreferred.slice(0, 3).join(', '),
    })
  }
  if (timeOffRespected.size > 0) {
    explanation.push({
      kind: 'time_off',
      headline: `Approved time off respected`,
      detail: `${[...timeOffRespected].join(', ')} — never scheduled over.`,
    })
  }
  explanation.push({
    kind: 'overtime',
    headline: 'No overtime',
    detail: 'Everyone stays at or under 40 hours.',
  })
  if (breaks > 0) {
    explanation.push({
      kind: 'breaks',
      headline: `${breaks} meal breaks placed`,
      detail: 'From your template’s break rules, staggered across the role.',
    })
  }
  if (openSlots.length > 0) {
    explanation.push({
      kind: 'open',
      headline: `${openSlots.length} ${openSlots.length === 1 ? 'slot' : 'slots'} left open`,
      detail: `${openSlots.slice(0, 3).join('; ')} — nobody qualified is free.`,
    })
  }

  if (filled > 0) {
    await markChanged(tx, actor.organizationId, scheduleId)
    await tx
      .delete(scheduleDayReviews)
      .where(
        and(
          eq(scheduleDayReviews.organizationId, actor.organizationId),
          eq(scheduleDayReviews.scheduleId, scheduleId),
        ),
      )
    await recordAuditEvent(tx, actor, {
      action: AUDIT_ACTIONS.SHIFT_TEMPLATE_APPLIED,
      summary: `Autofilled ${filled} of ${total} slots at ${location.name}`,
      subjectType: 'schedule',
      subjectId: scheduleId,
      locationId: schedule.locationId,
      metadata: { filled, total, notPreferred: notPreferred.length, open: openSlots.length },
    })
  }

  const assigned = rows.filter((r) => r.assigneeEmploymentId).length + filled
  return { filled: assigned, total, explanation, picks }
}

// ---------------------------------------------------------------------------
// Review, one day at a time
// ---------------------------------------------------------------------------

export type DayState = 'pending' | 'approved' | 'flagged'

export interface DayIssue {
  kind: 'unavailable' | 'not_preferred' | 'open' | 'overtime'
  /** Plain English, addressed to the manager. */
  message: string
  shiftId: string | null
}

export interface DayCard {
  date: string
  weekday: number
  state: DayState
  filled: number
  slots: number
  staffMinutes: number
  breaks: number
  issues: DayIssue[]
  shifts: {
    id: string
    roleName: string | null
    startsAt: Date
    endsAt: Date
    breakMinutes: number
    time: string
    assigneeId: string | null
    assigneeName: string | null
    state: AvailabilityState | null
    overridden: boolean
    note: string
  }[]
}

export interface WeekReview {
  scheduleId: string
  weekStart: string
  locationId: string
  locationName: string
  timeZone: string
  status: string
  days: DayCard[]
  filled: number
  slots: number
  overrides: { shiftId: string; name: string; when: string; reason: string }[]
  hours: { employmentId: string; displayName: string; minutes: number; nearOvertime: boolean }[]
}

/** Everything the review stack, the week grid and the final check all need. */
export async function weekReview(tx: Tx, actor: Actor, scheduleId: string): Promise<WeekReview> {
  const [schedule] = await tx
    .select()
    .from(schedules)
    .where(and(eq(schedules.organizationId, actor.organizationId), eq(schedules.id, scheduleId)))
    .limit(1)
  if (!schedule) throw new NotFoundError('Schedule not found')
  const location = await requireLocation(tx, actor.organizationId, schedule.locationId)

  const rows = await tx
    .select({
      id: shifts.id,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      breakMinutes: shifts.breakMinutes,
      jobRoleId: shifts.jobRoleId,
      roleName: jobRoles.name,
      assigneeId: shifts.assigneeEmploymentId,
      assigneeName: employments.displayName,
      notes: shifts.notes,
    })
    .from(shifts)
    .leftJoin(
      jobRoles,
      and(eq(jobRoles.organizationId, shifts.organizationId), eq(jobRoles.id, shifts.jobRoleId)),
    )
    .leftJoin(
      employments,
      and(
        eq(employments.organizationId, shifts.organizationId),
        eq(employments.id, shifts.assigneeEmploymentId),
      ),
    )
    .where(
      and(
        eq(shifts.organizationId, actor.organizationId),
        eq(shifts.scheduleId, scheduleId),
        eq(shifts.status, 'active'),
      ),
    )
    .orderBy(asc(shifts.startsAt))

  const reviews = await tx
    .select()
    .from(scheduleDayReviews)
    .where(
      and(
        eq(scheduleDayReviews.organizationId, actor.organizationId),
        eq(scheduleDayReviews.scheduleId, scheduleId),
      ),
    )
  const reviewByDate = new Map(reviews.map((r) => [r.onDate, r.state as 'approved' | 'flagged']))

  const overrideRows = await tx
    .select()
    .from(scheduleOverrides)
    .where(
      and(
        eq(scheduleOverrides.organizationId, actor.organizationId),
        eq(scheduleOverrides.scheduleId, scheduleId),
      ),
    )
  const overrideByShift = new Map(overrideRows.map((o) => [o.shiftId, o]))

  const assignees = [...new Set(rows.map((r) => r.assigneeId).filter((id): id is string => !!id))]
  const { from, to } = weekBounds(location, schedule.weekStart)
  const context = await loadConflictPeople(tx, actor.organizationId, assignees, { from, to })

  const days: DayCard[] = []
  const hoursByPerson = new Map<string, { displayName: string; minutes: number }>()

  for (const date of weekDates(schedule.weekStart)) {
    // Every date of the week is present, including the ones the template
    // leaves closed: a day with no slots is a fact about the week, not a gap
    // in it. Callers that ask a question about a day - the review stack, the
    // final check - skip the ones with nothing in them.
    const onDay = rows.filter((r) => localDateOf(r.startsAt, location.timeZone) === date)

    const issues: DayIssue[] = []
    const cardShifts: DayCard['shifts'] = []
    let staffMinutes = 0

    for (const row of onDay) {
      const label = formatShift(row.startsAt, row.endsAt, location.timeZone)
      let state: AvailabilityState | null = null

      if (row.assigneeId) {
        const person = context.get(row.assigneeId)
        if (person) {
          state = availabilityStateFor(
            { startsAt: row.startsAt, endsAt: row.endsAt, timeZone: location.timeZone },
            person,
          )
        }
        const worked = paidMinutes(row.startsAt, row.endsAt, row.breakMinutes)
        staffMinutes += worked
        const current = hoursByPerson.get(row.assigneeId)
        hoursByPerson.set(row.assigneeId, {
          displayName: row.assigneeName ?? 'Someone',
          minutes: (current?.minutes ?? 0) + worked,
        })

        const first = (row.assigneeName ?? 'They').split(' ')[0]
        if (state === 'unavailable') {
          issues.push({
            kind: 'unavailable',
            message: `${first} is marked unavailable for this shift.`,
            shiftId: row.id,
          })
        } else if (state === 'not_preferred') {
          issues.push({
            kind: 'not_preferred',
            message: `${first} prefers not to work ${label.time.toLowerCase()}.`,
            shiftId: row.id,
          })
        }
      } else {
        issues.push({
          kind: 'open',
          message: `${row.roleName ?? 'A shift'} at ${label.time} has nobody in it.`,
          shiftId: row.id,
        })
      }

      cardShifts.push({
        id: row.id,
        roleName: row.roleName,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        breakMinutes: row.breakMinutes,
        time: label.time,
        assigneeId: row.assigneeId,
        assigneeName: row.assigneeName,
        state,
        overridden: overrideByShift.has(row.id),
        note: row.notes,
      })
    }

    days.push({
      date,
      weekday: isoWeekday(date),
      state: reviewByDate.get(date) ?? 'pending',
      filled: onDay.filter((r) => r.assigneeId).length,
      slots: onDay.length,
      staffMinutes,
      breaks: onDay.filter((r) => r.breakMinutes > 0 && r.assigneeId).length,
      issues,
      shifts: cardShifts,
    })
  }

  const hours = [...hoursByPerson.entries()]
    .map(([employmentId, value]) => ({
      employmentId,
      displayName: value.displayName,
      minutes: value.minutes,
      nearOvertime: value.minutes >= OVERTIME_MINUTES - 6 * 60,
    }))
    .sort((a, b) => b.minutes - a.minutes)

  const overrides = overrideRows.map((override) => {
    const row = rows.find((r) => r.id === override.shiftId)
    const label = row ? formatShift(row.startsAt, row.endsAt, location.timeZone) : null
    return {
      shiftId: override.shiftId,
      name: row?.assigneeName ?? 'Someone',
      when: label ? `${label.day}, ${label.time}` : '',
      reason: override.reason,
    }
  })

  return {
    scheduleId,
    weekStart: schedule.weekStart,
    locationId: schedule.locationId,
    locationName: location.name,
    timeZone: location.timeZone,
    status: schedule.status,
    days,
    filled: rows.filter((r) => r.assigneeId).length,
    slots: rows.length,
    overrides,
    hours,
  }
}

export async function setDayReview(
  tx: Tx,
  actor: Actor,
  scheduleId: string,
  onDate: string,
  state: 'approved' | 'flagged',
  note = '',
): Promise<void> {
  const [schedule] = await tx
    .select({ locationId: schedules.locationId })
    .from(schedules)
    .where(and(eq(schedules.organizationId, actor.organizationId), eq(schedules.id, scheduleId)))
    .limit(1)
  if (!schedule) throw new NotFoundError('Schedule not found')
  await requireLocationCapability(tx, actor, schedule.locationId, 'schedule.draft')

  await tx
    .insert(scheduleDayReviews)
    .values({
      id: newId(),
      organizationId: actor.organizationId,
      scheduleId,
      onDate,
      state,
      note,
      reviewedByEmploymentId: actor.employmentId,
    })
    .onConflictDoUpdate({
      target: [
        scheduleDayReviews.organizationId,
        scheduleDayReviews.scheduleId,
        scheduleDayReviews.onDate,
      ],
      set: { state, note, reviewedByEmploymentId: actor.employmentId, reviewedAt: new Date() },
    })
}

/** A day that changed has not been reviewed in its new shape. */
async function clearDayReview(
  tx: Tx,
  actor: Actor,
  scheduleId: string,
  onDate: string,
): Promise<void> {
  await tx
    .delete(scheduleDayReviews)
    .where(
      and(
        eq(scheduleDayReviews.organizationId, actor.organizationId),
        eq(scheduleDayReviews.scheduleId, scheduleId),
        eq(scheduleDayReviews.onDate, onDate),
      ),
    )
}

// ---------------------------------------------------------------------------
// Call-outs
// ---------------------------------------------------------------------------

export interface CalloutSummary {
  id: string
  shiftId: string
  employmentId: string
  displayName: string
  roleName: string | null
  when: string
  reason: string
  reportedAt: Date
  replacementName: string | null
  resolvedAt: Date | null
}

/**
 * Somebody cannot work a shift they were given.
 *
 * Recorded as an event rather than an edit, so what happens next - a ranked
 * list of who could cover, with hours and overtime visible before the manager
 * commits - is a decision with a name and a time on it. The shift is left
 * assigned until somebody replaces them, so nothing silently disappears off
 * the floor plan.
 */
export async function reportCallout(
  tx: Tx,
  actor: Actor,
  shiftId: string,
  reason: string,
): Promise<string> {
  const { shift } = await slotContext(tx, actor, shiftId)
  await requireLocationCapability(tx, actor, shift.locationId, 'schedule.draft')
  if (!shift.assigneeEmploymentId) {
    throw new ValidationError({ shiftId: ['Nobody is on that shift.'] })
  }

  const id = newId()
  await tx
    .insert(shiftCallouts)
    .values({
      id,
      organizationId: actor.organizationId,
      shiftId,
      employmentId: shift.assigneeEmploymentId,
      reason: reason.trim(),
      reportedByEmploymentId: actor.employmentId,
    })
    .onConflictDoUpdate({
      target: [shiftCallouts.organizationId, shiftCallouts.shiftId],
      set: {
        employmentId: shift.assigneeEmploymentId,
        reason: reason.trim(),
        reportedByEmploymentId: actor.employmentId,
        reportedAt: new Date(),
        replacementEmploymentId: null,
        resolvedAt: null,
      },
    })
  return id
}

export async function listOpenCallouts(
  tx: Tx,
  actor: Actor,
  locationId: string,
): Promise<CalloutSummary[]> {
  const rows = await tx
    .select({
      id: shiftCallouts.id,
      shiftId: shiftCallouts.shiftId,
      employmentId: shiftCallouts.employmentId,
      displayName: employments.displayName,
      reason: shiftCallouts.reason,
      reportedAt: shiftCallouts.reportedAt,
      resolvedAt: shiftCallouts.resolvedAt,
      replacementId: shiftCallouts.replacementEmploymentId,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      roleName: jobRoles.name,
      locationId: shifts.locationId,
    })
    .from(shiftCallouts)
    .innerJoin(
      shifts,
      and(
        eq(shifts.organizationId, shiftCallouts.organizationId),
        eq(shifts.id, shiftCallouts.shiftId),
      ),
    )
    .innerJoin(
      employments,
      and(
        eq(employments.organizationId, shiftCallouts.organizationId),
        eq(employments.id, shiftCallouts.employmentId),
      ),
    )
    .leftJoin(
      jobRoles,
      and(eq(jobRoles.organizationId, shifts.organizationId), eq(jobRoles.id, shifts.jobRoleId)),
    )
    .where(
      and(
        eq(shiftCallouts.organizationId, actor.organizationId),
        eq(shifts.locationId, locationId),
      ),
    )
    .orderBy(asc(shiftCallouts.reportedAt))

  const location = await requireLocation(tx, actor.organizationId, locationId)
  const names = await tx
    .select({ id: employments.id, displayName: employments.displayName })
    .from(employments)
    .where(eq(employments.organizationId, actor.organizationId))
  const nameById = new Map(names.map((n) => [n.id, n.displayName]))

  return rows.map((row) => {
    const label = formatShift(row.startsAt, row.endsAt, location.timeZone)
    return {
      id: row.id,
      shiftId: row.shiftId,
      employmentId: row.employmentId,
      displayName: row.displayName,
      roleName: row.roleName,
      when: `${label.day}, ${label.time}`,
      reason: row.reason,
      reportedAt: row.reportedAt,
      replacementName: row.replacementId ? (nameById.get(row.replacementId) ?? null) : null,
      resolvedAt: row.resolvedAt,
    }
  })
}

/**
 * Who could cover, ranked, with the consequences shown.
 *
 * The same four states and the same hours arithmetic as everywhere else, plus
 * the one number that decides most call-outs in practice: what their week
 * becomes if they say yes.
 */
export async function replacementCandidates(tx: Tx, actor: Actor, shiftId: string) {
  const { candidates, roleName } = await candidatesForSlot(tx, actor, shiftId)
  const { shift } = await slotContext(tx, actor, shiftId)
  return {
    roleName,
    candidates: candidates.filter((c) => c.employmentId !== shift.assigneeEmploymentId),
  }
}

export async function fillCallout(
  tx: Tx,
  actor: Actor,
  shiftId: string,
  replacementId: string,
  options: { overrideUnavailable?: boolean } = {},
): Promise<void> {
  await assignToSlot(tx, actor, shiftId, replacementId, options)
  await tx
    .update(shiftCallouts)
    .set({ replacementEmploymentId: replacementId, resolvedAt: new Date() })
    .where(
      and(
        eq(shiftCallouts.organizationId, actor.organizationId),
        eq(shiftCallouts.shiftId, shiftId),
      ),
    )
}
