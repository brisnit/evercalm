import { and, asc, desc, eq, gt, gte, inArray, lte, ne, or, sql } from 'drizzle-orm'
import type { Tx } from '@/server/db'
import {
  employmentLocations,
  employments,
  jobRoles,
  locations,
  organizations,
} from '@/server/db/schema'
import type { Actor } from '@/server/authz'
import { accessibleLocationIds, can, isSelf } from '@/server/authz/can'
import { AUDIT_ACTIONS, recordAuditEvent } from '@/server/audit'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { newId } from '@/lib/ids'
import { addCalendarDays } from '@/lib/dates'
import {
  EXCLUSION_VIOLATION,
  UNIQUE_VIOLATION,
  canSeeSchedulingAt,
  loadLocations,
  personLocationIds,
  pgErrorCode,
  requireLocation,
  requireLocationCapability,
  requireSelfOrCapabilityForPerson,
} from './access'
import {
  detectConflicts,
  hasBlockingConflict,
  timeOffPeriod,
  toSecondPerson,
  type PersonForConflicts,
} from './conflicts'
import { notifySchedulePeople } from './notify'
import { conflictShift, listSchedulablePeople, loadConflictPeople, withoutShifts } from './people'
import {
  AVAILABILITY_PREFERENCES,
  TIME_OFF_REASONS,
  availabilityExceptions,
  availabilityRules,
  openShiftClaims,
  shiftSwapRequests,
  shifts,
  timeOffRequests,
  type SwapKind,
} from './schema'
import { StaleShiftError, displayNames, reassignNow, requireShift } from './service'
import {
  MINUTES_PER_DAY,
  formatIsoDate,
  formatShift,
  formatTimeOfDay,
  isIsoDate,
  localDateOf,
  overlaps,
  weekDates,
} from './time'

/*
 * REQUESTS: availability, time off, open-shift claims, and swaps.
 *
 * The states each request moves through are the ones a person can see on the
 * screen, and every transition is a CONDITIONAL update on the state it
 * expects ("... WHERE status = 'pending'"). Two people acting on the same
 * request at the same moment therefore cannot both succeed: the second finds
 * the row no longer in the state it needs and is told so.
 *
 * Nobody decides their own request. A manager who also works shifts asks
 * like anyone else and someone else answers.
 */

const NOTE_MAX = 500
const MAX_TIME_OFF_DAYS = 60

function note(value: string | null | undefined): string {
  return (value ?? '').trim().slice(0, NOTE_MAX)
}

/** Today's date where a person works: home location, else the organization. */
async function personToday(tx: Tx, organizationId: string, employmentId: string, now: Date) {
  const [row] = await tx
    .select({ locationTimeZone: locations.timezone, orgTimeZone: organizations.timezone })
    .from(employments)
    .innerJoin(organizations, eq(organizations.id, employments.organizationId))
    .leftJoin(
      locations,
      and(
        eq(locations.organizationId, employments.organizationId),
        eq(locations.id, employments.homeLocationId),
      ),
    )
    .where(and(eq(employments.organizationId, organizationId), eq(employments.id, employmentId)))
    .limit(1)
  const timeZone = row?.locationTimeZone ?? row?.orgTimeZone ?? 'UTC'
  return { today: localDateOf(now, timeZone), timeZone }
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

export interface AvailabilityRuleInput {
  weekday: number
  startMinute: number
  endMinute: number
  preference: string
}

export interface AvailabilityView {
  rules: {
    id: string
    weekday: number
    startMinute: number
    endMinute: number
    preference: string
  }[]
  exceptions: {
    id: string
    onDate: string
    startMinute: number | null
    endMinute: number | null
    preference: string
    note: string
  }[]
}

export async function getAvailability(
  tx: Tx,
  actor: Actor,
  employmentId: string,
  options: { fromDate?: string } = {},
): Promise<AvailabilityView> {
  await requireSelfOrCapabilityForPerson(tx, actor, employmentId, 'availability.view_team')
  const rules = await tx
    .select({
      id: availabilityRules.id,
      weekday: availabilityRules.weekday,
      startMinute: availabilityRules.startMinute,
      endMinute: availabilityRules.endMinute,
      preference: availabilityRules.preference,
    })
    .from(availabilityRules)
    .where(
      and(
        eq(availabilityRules.organizationId, actor.organizationId),
        eq(availabilityRules.employmentId, employmentId),
      ),
    )
    .orderBy(asc(availabilityRules.weekday), asc(availabilityRules.startMinute))
  const exceptions = await tx
    .select({
      id: availabilityExceptions.id,
      onDate: availabilityExceptions.onDate,
      startMinute: availabilityExceptions.startMinute,
      endMinute: availabilityExceptions.endMinute,
      preference: availabilityExceptions.preference,
      note: availabilityExceptions.note,
    })
    .from(availabilityExceptions)
    .where(
      and(
        eq(availabilityExceptions.organizationId, actor.organizationId),
        eq(availabilityExceptions.employmentId, employmentId),
        options.fromDate ? gte(availabilityExceptions.onDate, options.fromDate) : undefined,
      ),
    )
    .orderBy(asc(availabilityExceptions.onDate), asc(availabilityExceptions.startMinute))
  return { rules, exceptions }
}

function validateWindow(startMinute: number, endMinute: number): string | null {
  if (!Number.isInteger(startMinute) || !Number.isInteger(endMinute))
    return 'Enter a start and end time.'
  if (startMinute < 0 || endMinute > MINUTES_PER_DAY) return 'Times must be within the day.'
  if (endMinute <= startMinute) return 'The end time needs to be after the start time.'
  return null
}

/**
 * Replace a person's weekly availability. Self only: availability is what
 * someone declares about themselves, and a manager editing it would make the
 * conflict warnings meaningless.
 */
export async function replaceWeeklyAvailability(
  tx: Tx,
  actor: Actor,
  employmentId: string,
  rules: readonly AvailabilityRuleInput[],
): Promise<void> {
  if (!isSelf(actor, employmentId))
    throw new ForbiddenError(undefined, 'Only you can change your availability.')
  if (rules.length > 42)
    throw new ValidationError({}, 'That is more availability windows than a week needs.')

  const errors: string[] = []
  for (const [index, rule] of rules.entries()) {
    const problem = validateWindow(rule.startMinute, rule.endMinute)
    if (problem) errors.push(`Row ${index + 1}: ${problem}`)
    if (!Number.isInteger(rule.weekday) || rule.weekday < 1 || rule.weekday > 7)
      errors.push(`Row ${index + 1}: choose a day.`)
    if (!(AVAILABILITY_PREFERENCES as readonly string[]).includes(rule.preference))
      errors.push(`Row ${index + 1}: choose available, preferred or unavailable.`)
  }
  for (let d = 1; d <= 7; d += 1) {
    const day = rules.filter((r) => r.weekday === d).sort((a, b) => a.startMinute - b.startMinute)
    for (let i = 1; i < day.length; i += 1) {
      if (day[i]!.startMinute < day[i - 1]!.endMinute) {
        errors.push('Two windows on the same day overlap. Make each time belong to one window.')
        break
      }
    }
  }
  if (errors.length > 0) throw new ValidationError({ rules: errors }, errors[0])

  await tx
    .delete(availabilityRules)
    .where(
      and(
        eq(availabilityRules.organizationId, actor.organizationId),
        eq(availabilityRules.employmentId, employmentId),
      ),
    )
  if (rules.length > 0) {
    await tx.insert(availabilityRules).values(
      rules.map((rule) => ({
        id: newId(),
        organizationId: actor.organizationId,
        employmentId,
        weekday: rule.weekday,
        startMinute: rule.startMinute,
        endMinute: rule.endMinute,
        preference: rule.preference,
      })),
    )
  }
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.AVAILABILITY_UPDATED,
    summary: `Updated their weekly availability (${rules.length} ${rules.length === 1 ? 'window' : 'windows'})`,
    subjectType: 'employment',
    subjectId: employmentId,
  })
}

export async function addAvailabilityException(
  tx: Tx,
  actor: Actor,
  employmentId: string,
  input: {
    onDate: string
    startMinute: number | null
    endMinute: number | null
    preference: string
    note: string
  },
  now = new Date(),
): Promise<string> {
  if (!isSelf(actor, employmentId))
    throw new ForbiddenError(undefined, 'Only you can change your availability.')
  const errors: Record<string, string[]> = {}
  const { today } = await personToday(tx, actor.organizationId, employmentId, now)
  if (!isIsoDate(input.onDate)) errors.onDate = ['Choose a date.']
  else if (input.onDate < today) errors.onDate = ['Choose today or a later date.']
  const partial = input.startMinute !== null || input.endMinute !== null
  if (partial) {
    const problem = validateWindow(input.startMinute ?? -1, input.endMinute ?? -1)
    if (problem) errors.endTime = [problem]
  }
  if (input.preference !== 'available' && input.preference !== 'unavailable') {
    errors.preference = ['Choose available or unavailable.']
  }
  if (Object.keys(errors).length > 0)
    throw new ValidationError(errors, 'Check the highlighted fields.')

  const id = newId()
  await tx.insert(availabilityExceptions).values({
    id,
    organizationId: actor.organizationId,
    employmentId,
    onDate: input.onDate,
    startMinute: partial ? input.startMinute : null,
    endMinute: partial ? input.endMinute : null,
    preference: input.preference,
    note: note(input.note),
  })
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.AVAILABILITY_UPDATED,
    summary: `Marked themselves ${input.preference} on ${formatIsoDate(input.onDate)}`,
    subjectType: 'employment',
    subjectId: employmentId,
  })
  return id
}

export async function removeAvailabilityException(
  tx: Tx,
  actor: Actor,
  exceptionId: string,
): Promise<void> {
  const rows = await tx
    .delete(availabilityExceptions)
    .where(
      and(
        eq(availabilityExceptions.organizationId, actor.organizationId),
        eq(availabilityExceptions.id, exceptionId),
        eq(availabilityExceptions.employmentId, actor.employmentId),
      ),
    )
    .returning({ onDate: availabilityExceptions.onDate })
  if (rows.length === 0) throw new NotFoundError('Availability change not found')
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.AVAILABILITY_UPDATED,
    summary: `Removed their availability change for ${formatIsoDate(rows[0]!.onDate)}`,
    subjectType: 'employment',
    subjectId: actor.employmentId,
  })
}

export interface TeamAvailabilityRow {
  employmentId: string
  displayName: string
  days: {
    date: string
    labels: string[]
    tone: 'unavailable' | 'preferred' | 'time_off' | 'pending_time_off' | 'none'
  }[]
}

/** What a location's people have said about a week, for the manager building it. */
export async function loadTeamAvailability(
  tx: Tx,
  actor: Actor,
  locationId: string,
  weekStart: string,
): Promise<TeamAvailabilityRow[]> {
  await requireLocationCapability(tx, actor, locationId, 'availability.view_team')
  const people = await listSchedulablePeople(tx, actor.organizationId, locationId)
  const ids = people.map((p) => p.employmentId)
  if (ids.length === 0) return []
  const dates = weekDates(weekStart)

  const rules = await tx
    .select()
    .from(availabilityRules)
    .where(
      and(
        eq(availabilityRules.organizationId, actor.organizationId),
        inArray(availabilityRules.employmentId, ids),
      ),
    )
  const exceptions = await tx
    .select()
    .from(availabilityExceptions)
    .where(
      and(
        eq(availabilityExceptions.organizationId, actor.organizationId),
        inArray(availabilityExceptions.employmentId, ids),
        sql`${availabilityExceptions.onDate} between ${dates[0]} and ${dates[6]}`,
      ),
    )
  const timeOff = await tx
    .select()
    .from(timeOffRequests)
    .where(
      and(
        eq(timeOffRequests.organizationId, actor.organizationId),
        inArray(timeOffRequests.employmentId, ids),
        inArray(timeOffRequests.status, ['pending', 'approved']),
        lte(timeOffRequests.startsOn, dates[6]!),
        gte(timeOffRequests.endsOn, dates[0]!),
      ),
    )

  const window = (start: number | null, end: number | null) =>
    start === null || end === null || (start === 0 && end === MINUTES_PER_DAY)
      ? 'all day'
      : `${formatTimeOfDay(start)}–${formatTimeOfDay(end)}`

  return people.map((person) => ({
    employmentId: person.employmentId,
    displayName: person.displayName,
    days: dates.map((date) => {
      const weekday = ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1
      const off = timeOff.filter(
        (t) => t.employmentId === person.employmentId && t.startsOn <= date && t.endsOn >= date,
      )
      if (off.some((t) => t.status === 'approved')) {
        return { date, labels: ['Time off'], tone: 'time_off' as const }
      }
      const dayExceptions = exceptions.filter(
        (e) => e.employmentId === person.employmentId && e.onDate === date,
      )
      const source =
        dayExceptions.length > 0
          ? dayExceptions.map((e) => ({
              preference: e.preference,
              startMinute: e.startMinute,
              endMinute: e.endMinute,
            }))
          : rules
              .filter((r) => r.employmentId === person.employmentId && r.weekday === weekday)
              .map((r) => ({
                preference: r.preference,
                startMinute: r.startMinute,
                endMinute: r.endMinute,
              }))
      const unavailable = source.filter((s) => s.preference === 'unavailable')
      const preferred = source.filter((s) => s.preference === 'preferred')
      const labels = [
        ...(off.length > 0 ? ['Time off requested'] : []),
        ...unavailable.map((s) => `Unavailable ${window(s.startMinute, s.endMinute)}`),
        ...preferred.map((s) => `Prefers ${window(s.startMinute, s.endMinute)}`),
      ]
      const tone =
        off.length > 0
          ? 'pending_time_off'
          : unavailable.length > 0
            ? 'unavailable'
            : preferred.length > 0
              ? 'preferred'
              : 'none'
      return { date, labels, tone }
    }),
  }))
}

// ---------------------------------------------------------------------------
// Time off
// ---------------------------------------------------------------------------

export interface TimeOffInput {
  startsOn: string
  endsOn: string
  startMinute: number | null
  endMinute: number | null
  reason: string
  note: string
}

export interface TimeOffView {
  id: string
  employmentId: string
  displayName: string
  startsOn: string
  endsOn: string
  startMinute: number | null
  endMinute: number | null
  period: string
  reason: string
  note: string
  status: string
  decidedByName: string | null
  decidedAt: Date | null
  decisionNote: string
  createdAt: Date
  /** Assigned shifts the request overlaps, with their location. */
  affectedShifts: { id: string; label: string; locationName: string }[]
}

export function describeTimeOffPeriod(r: {
  startsOn: string
  endsOn: string
  startMinute: number | null
  endMinute: number | null
}): string {
  if (r.startMinute !== null && r.endMinute !== null) {
    return `${formatIsoDate(r.startsOn)}, ${formatTimeOfDay(r.startMinute)}–${formatTimeOfDay(r.endMinute)}`
  }
  return r.startsOn === r.endsOn
    ? formatIsoDate(r.startsOn)
    : `${formatIsoDate(r.startsOn)} to ${formatIsoDate(r.endsOn)}`
}

export async function requestTimeOff(
  tx: Tx,
  actor: Actor,
  input: TimeOffInput,
  now = new Date(),
): Promise<string> {
  const { today } = await personToday(tx, actor.organizationId, actor.employmentId, now)
  const errors: Record<string, string[]> = {}
  if (!isIsoDate(input.startsOn)) errors.startsOn = ['Choose the first day.']
  if (!isIsoDate(input.endsOn)) errors.endsOn = ['Choose the last day.']
  if (isIsoDate(input.startsOn) && input.startsOn < today)
    errors.startsOn = ['Time off starts today or later.']
  if (isIsoDate(input.startsOn) && isIsoDate(input.endsOn)) {
    if (input.endsOn < input.startsOn)
      errors.endsOn = ['The last day is on or after the first day.']
    else if (addCalendarDays(input.startsOn, MAX_TIME_OFF_DAYS - 1) < input.endsOn) {
      errors.endsOn = [`Ask for up to ${MAX_TIME_OFF_DAYS} days at a time.`]
    }
  }
  const partial = input.startMinute !== null || input.endMinute !== null
  if (partial) {
    if (input.startsOn !== input.endsOn) errors.endsOn = ['Part of a day can only be one date.']
    const problem = validateWindow(input.startMinute ?? -1, input.endMinute ?? -1)
    if (problem) errors.endTime = [problem]
  }
  if (!(TIME_OFF_REASONS as readonly string[]).includes(input.reason))
    errors.reason = ['Choose a reason.']
  if (Object.keys(errors).length > 0)
    throw new ValidationError(errors, 'Check the highlighted fields.')

  const overlapping = await tx
    .select({ id: timeOffRequests.id })
    .from(timeOffRequests)
    .where(
      and(
        eq(timeOffRequests.organizationId, actor.organizationId),
        eq(timeOffRequests.employmentId, actor.employmentId),
        inArray(timeOffRequests.status, ['pending', 'approved']),
        lte(timeOffRequests.startsOn, input.endsOn),
        gte(timeOffRequests.endsOn, input.startsOn),
      ),
    )
    .limit(1)
  if (overlapping.length > 0) {
    throw new ValidationError(
      { startsOn: ['You already have time off requested or approved on these dates.'] },
      'Those dates overlap a request you already made.',
    )
  }

  const id = newId()
  await tx.insert(timeOffRequests).values({
    id,
    organizationId: actor.organizationId,
    employmentId: actor.employmentId,
    startsOn: input.startsOn,
    endsOn: input.endsOn,
    startMinute: partial ? input.startMinute : null,
    endMinute: partial ? input.endMinute : null,
    reason: input.reason,
    note: note(input.note),
  })
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.TIME_OFF_REQUESTED,
    // The reason and note are not repeated into the audit log: they can be
    // personal (a medical appointment), and the log is read by administrators.
    summary: `Requested time off: ${describeTimeOffPeriod({ ...input, startMinute: partial ? input.startMinute : null, endMinute: partial ? input.endMinute : null })}`,
    subjectType: 'time_off',
    subjectId: id,
  })
  return id
}

export async function cancelTimeOff(
  tx: Tx,
  actor: Actor,
  requestId: string,
  now = new Date(),
): Promise<void> {
  const [request] = await tx
    .select()
    .from(timeOffRequests)
    .where(
      and(
        eq(timeOffRequests.organizationId, actor.organizationId),
        eq(timeOffRequests.id, requestId),
      ),
    )
    .limit(1)
  if (!request || request.employmentId !== actor.employmentId)
    throw new NotFoundError('Request not found')
  const { today } = await personToday(tx, actor.organizationId, actor.employmentId, now)
  if (request.status === 'approved' && request.endsOn < today) {
    throw new ValidationError({}, 'This time off has already happened.')
  }
  const rows = await tx
    .update(timeOffRequests)
    .set({ status: 'cancelled', cancelledAt: now, updatedAt: now })
    .where(
      and(
        eq(timeOffRequests.organizationId, actor.organizationId),
        eq(timeOffRequests.id, requestId),
        inArray(timeOffRequests.status, ['pending', 'approved']),
      ),
    )
    .returning({ id: timeOffRequests.id })
  if (rows.length === 0) throw new ValidationError({}, 'This request is no longer open.')
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.TIME_OFF_CANCELLED,
    summary: `Cancelled their ${request.status} time off: ${describeTimeOffPeriod(request)}`,
    subjectType: 'time_off',
    subjectId: requestId,
  })
}

async function timeOffViews(
  tx: Tx,
  organizationId: string,
  where: ReturnType<typeof and>,
): Promise<TimeOffView[]> {
  const rows = await tx
    .select({
      request: timeOffRequests,
      displayName: employments.displayName,
    })
    .from(timeOffRequests)
    .innerJoin(
      employments,
      and(
        eq(employments.organizationId, timeOffRequests.organizationId),
        eq(employments.id, timeOffRequests.employmentId),
      ),
    )
    .where(and(eq(timeOffRequests.organizationId, organizationId), where))
    .orderBy(desc(timeOffRequests.createdAt))
    .limit(200)

  const deciders = await displayNames(
    tx,
    organizationId,
    rows.map((r) => r.request.decidedByEmploymentId),
  )
  const ids = [...new Set(rows.map((r) => r.request.employmentId))]
  const locationMap = await loadLocations(tx, organizationId)
  const assigned = ids.length
    ? await tx
        .select({
          id: shifts.id,
          assignee: shifts.assigneeEmploymentId,
          startsAt: shifts.startsAt,
          endsAt: shifts.endsAt,
          locationId: shifts.locationId,
        })
        .from(shifts)
        .where(
          and(
            eq(shifts.organizationId, organizationId),
            eq(shifts.status, 'active'),
            inArray(shifts.assigneeEmploymentId, ids),
            gt(shifts.endsAt, new Date(Date.now() - 86_400_000)),
          ),
        )
    : []

  return rows.map(({ request, displayName }) => {
    const affected =
      request.status === 'pending' || request.status === 'approved'
        ? assigned
            .filter((s) => s.assignee === request.employmentId)
            .filter((s) => {
              const location = locationMap.get(s.locationId)
              const period = location ? timeOffPeriod(request, location.timeZone) : null
              return period ? overlaps(s.startsAt, s.endsAt, period.start, period.end) : false
            })
            .map((s) => {
              const location = locationMap.get(s.locationId)!
              const label = formatShift(s.startsAt, s.endsAt, location.timeZone)
              return { id: s.id, label: `${label.day}, ${label.time}`, locationName: location.name }
            })
        : []
    return {
      id: request.id,
      employmentId: request.employmentId,
      displayName,
      startsOn: request.startsOn,
      endsOn: request.endsOn,
      startMinute: request.startMinute,
      endMinute: request.endMinute,
      period: describeTimeOffPeriod(request),
      reason: request.reason,
      note: request.note,
      status: request.status,
      decidedByName: request.decidedByEmploymentId
        ? (deciders.get(request.decidedByEmploymentId) ?? null)
        : null,
      decidedAt: request.decidedAt,
      decisionNote: request.decisionNote,
      createdAt: request.createdAt,
      affectedShifts: affected,
    }
  })
}

export async function listMyTimeOff(tx: Tx, actor: Actor): Promise<TimeOffView[]> {
  return timeOffViews(
    tx,
    actor.organizationId,
    eq(timeOffRequests.employmentId, actor.employmentId),
  )
}

/** Employments whose locations intersect where the actor holds `capability`. */
async function peopleInScope(
  tx: Tx,
  actor: Actor,
  capability: 'timeoff.decide',
): Promise<string[] | null> {
  const scope = accessibleLocationIds(actor, capability)
  if (scope === null) return null
  if (scope.length === 0) return []
  const rows = await tx
    .selectDistinct({ employmentId: employmentLocations.employmentId })
    .from(employmentLocations)
    .where(
      and(
        eq(employmentLocations.organizationId, actor.organizationId),
        inArray(employmentLocations.locationId, scope),
      ),
    )
  return rows.map((r) => r.employmentId)
}

export async function listTimeOffForReview(
  tx: Tx,
  actor: Actor,
  options: { status?: 'pending' | 'decided' } = {},
): Promise<TimeOffView[]> {
  const people = await peopleInScope(tx, actor, 'timeoff.decide')
  if (people !== null && people.length === 0) return []
  return timeOffViews(
    tx,
    actor.organizationId,
    and(
      people === null ? undefined : inArray(timeOffRequests.employmentId, people),
      options.status === 'pending'
        ? eq(timeOffRequests.status, 'pending')
        : options.status === 'decided'
          ? inArray(timeOffRequests.status, ['approved', 'denied'])
          : undefined,
    ),
  )
}

/**
 * Approve or deny time off.
 *
 * Approving does not silently unassign anyone. If the person holds shifts in
 * that period, those shifts now carry a BLOCKING conflict, the schedule
 * cannot be republished until a manager reassigns or opens them, and the
 * decision result lists them so the manager goes straight there.
 */
export async function decideTimeOff(
  tx: Tx,
  actor: Actor,
  requestId: string,
  decision: 'approved' | 'denied',
  decisionNote: string,
  now = new Date(),
): Promise<{ affectedShifts: TimeOffView['affectedShifts'] }> {
  const [request] = await tx
    .select()
    .from(timeOffRequests)
    .where(
      and(
        eq(timeOffRequests.organizationId, actor.organizationId),
        eq(timeOffRequests.id, requestId),
      ),
    )
    .limit(1)
  if (!request) throw new NotFoundError('Request not found')

  const personLocations = await personLocationIds(tx, actor.organizationId, request.employmentId)
  if (!personLocations.some((l) => canSeeSchedulingAt(actor, l)))
    throw new NotFoundError('Request not found')
  if (!personLocations.some((l) => can(actor, 'timeoff.decide', { locationId: l }))) {
    throw new ForbiddenError('timeoff.decide')
  }
  if (isSelf(actor, request.employmentId)) {
    throw new ForbiddenError('timeoff.decide', 'Someone else needs to decide your own time off.')
  }

  const rows = await tx
    .update(timeOffRequests)
    .set({
      status: decision,
      decidedByEmploymentId: actor.employmentId,
      decidedAt: now,
      decisionNote: note(decisionNote),
      updatedAt: now,
    })
    .where(
      and(
        eq(timeOffRequests.organizationId, actor.organizationId),
        eq(timeOffRequests.id, requestId),
        eq(timeOffRequests.status, 'pending'),
      ),
    )
    .returning({ id: timeOffRequests.id })
  if (rows.length === 0)
    throw new ValidationError({}, 'This request has already been decided or withdrawn.')

  const [view] = await timeOffViews(tx, actor.organizationId, eq(timeOffRequests.id, requestId))
  const period = describeTimeOffPeriod(request)
  await recordAuditEvent(tx, actor, {
    action:
      decision === 'approved' ? AUDIT_ACTIONS.TIME_OFF_APPROVED : AUDIT_ACTIONS.TIME_OFF_DENIED,
    summary: `${decision === 'approved' ? 'Approved' : 'Denied'} time off for ${view?.displayName ?? 'someone'}: ${period}${
      decision === 'approved' && view && view.affectedShifts.length > 0
        ? `. ${view.affectedShifts.length} assigned ${view.affectedShifts.length === 1 ? 'shift now conflicts' : 'shifts now conflict'}`
        : ''
    }`,
    subjectType: 'time_off',
    subjectId: requestId,
    metadata: { decision, affectedShifts: view?.affectedShifts.length ?? 0 },
  })
  await notifySchedulePeople(
    tx,
    actor.organizationId,
    [
      {
        employmentId: request.employmentId,
        subjectType: 'time_off',
        subjectId: requestId,
        title:
          decision === 'approved'
            ? `Time off approved: ${period}`
            : `Time off not approved: ${period}`,
        preview:
          note(decisionNote) ||
          (decision === 'approved'
            ? 'Enjoy your time off.'
            : 'Talk to your manager if you have questions.'),
        href: '/my/time-off',
        purpose: decision,
      },
    ],
    now,
  )
  return { affectedShifts: view?.affectedShifts ?? [] }
}

// ---------------------------------------------------------------------------
// Open shifts
// ---------------------------------------------------------------------------

async function requirePublishedOpenShift(tx: Tx, actor: Actor, shiftId: string, now: Date) {
  const shift = await requireShift(tx, actor.organizationId, shiftId)
  const visible =
    shift.publishedAt !== null &&
    shift.publishedStatus === 'active' &&
    shift.publishedIsOpen === true &&
    actor.locationIds.includes(shift.locationId)
  if (!visible) throw new NotFoundError('Shift not found')
  if (shift.startsAt.getTime() <= now.getTime())
    throw new ValidationError({}, 'This shift has already started.')
  if (!shift.isOpen || shift.assigneeEmploymentId !== null || shift.status !== 'active') {
    throw new ValidationError({}, 'This shift is no longer open.')
  }
  return shift
}

export async function claimOpenShift(
  tx: Tx,
  actor: Actor,
  shiftId: string,
  claimNote: string,
  now = new Date(),
): Promise<{ id: string; warnings: string[] }> {
  const shift = await requirePublishedOpenShift(tx, actor, shiftId, now)
  const location = await requireLocation(tx, actor.organizationId, shift.locationId)
  const people = await loadConflictPeople(tx, actor.organizationId, [actor.employmentId], {
    from: shift.startsAt,
    to: shift.endsAt,
  })
  const conflicts = detectConflicts(
    conflictShift(shift, location.timeZone),
    people.get(actor.employmentId)!,
  )
  if (hasBlockingConflict(conflicts)) {
    const message = toSecondPerson(
      conflicts.find((c) => c.severity === 'block')!.message,
      actor.displayName,
    )
    throw new ValidationError({}, message)
  }

  const id = newId()
  try {
    await tx.transaction(async (sp) => {
      await sp.insert(openShiftClaims).values({
        id,
        organizationId: actor.organizationId,
        shiftId,
        employmentId: actor.employmentId,
        note: note(claimNote),
      })
    })
  } catch (error) {
    if (pgErrorCode(error) === UNIQUE_VIOLATION)
      throw new ValidationError({}, 'You have already asked for this shift.')
    throw error
  }
  const label = formatShift(shift.startsAt, shift.endsAt, location.timeZone)
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.OPEN_SHIFT_CLAIMED,
    summary: `Asked for the open shift on ${label.day}, ${label.time} at ${location.name}`,
    subjectType: 'shift',
    subjectId: shiftId,
    locationId: location.id,
  })
  return { id, warnings: conflicts.map((c) => c.message) }
}

export async function withdrawClaim(
  tx: Tx,
  actor: Actor,
  claimId: string,
  now = new Date(),
): Promise<void> {
  const rows = await tx
    .update(openShiftClaims)
    .set({ status: 'withdrawn', updatedAt: now })
    .where(
      and(
        eq(openShiftClaims.organizationId, actor.organizationId),
        eq(openShiftClaims.id, claimId),
        eq(openShiftClaims.employmentId, actor.employmentId),
        eq(openShiftClaims.status, 'pending'),
      ),
    )
    .returning({ shiftId: openShiftClaims.shiftId })
  if (rows.length === 0) throw new NotFoundError('Request not found')
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.OPEN_SHIFT_CLAIM_WITHDRAWN,
    summary: 'Withdrew their request for an open shift',
    subjectType: 'shift',
    subjectId: rows[0]!.shiftId,
  })
}

export interface ClaimReview {
  id: string
  shiftId: string
  locationId: string
  locationName: string
  shiftLabel: string
  jobRoleName: string | null
  employmentId: string
  displayName: string
  note: string
  status: string
  createdAt: Date
  conflicts: { severity: string; message: string }[]
  decidedByName: string | null
  decisionNote: string
}

export async function listClaimsForReview(
  tx: Tx,
  actor: Actor,
  options: { status?: 'pending' | 'decided' } = {},
  now = new Date(),
): Promise<ClaimReview[]> {
  const scope = accessibleLocationIds(actor, 'openshift.manage')
  if (scope !== null && scope.length === 0) return []
  const rows = await tx
    .select({
      claim: openShiftClaims,
      shift: shifts,
      displayName: employments.displayName,
      jobRoleName: jobRoles.name,
    })
    .from(openShiftClaims)
    .innerJoin(
      shifts,
      and(
        eq(shifts.organizationId, openShiftClaims.organizationId),
        eq(shifts.id, openShiftClaims.shiftId),
      ),
    )
    .innerJoin(
      employments,
      and(
        eq(employments.organizationId, openShiftClaims.organizationId),
        eq(employments.id, openShiftClaims.employmentId),
      ),
    )
    .leftJoin(
      jobRoles,
      and(eq(jobRoles.organizationId, shifts.organizationId), eq(jobRoles.id, shifts.jobRoleId)),
    )
    .where(
      and(
        eq(openShiftClaims.organizationId, actor.organizationId),
        scope === null ? undefined : inArray(shifts.locationId, scope),
        options.status === 'pending'
          ? eq(openShiftClaims.status, 'pending')
          : options.status === 'decided'
            ? inArray(openShiftClaims.status, ['approved', 'declined'])
            : undefined,
      ),
    )
    .orderBy(asc(shifts.startsAt), asc(openShiftClaims.createdAt))
    .limit(200)

  const locationMap = await loadLocations(tx, actor.organizationId)
  const pendingPeople = rows
    .filter((r) => r.claim.status === 'pending')
    .map((r) => r.claim.employmentId)
  const context = rows.length
    ? await loadConflictPeople(tx, actor.organizationId, pendingPeople, {
        from: new Date(Math.min(...rows.map((r) => r.shift.startsAt.getTime()))),
        to: new Date(Math.max(...rows.map((r) => r.shift.endsAt.getTime()))),
      })
    : new Map<string, PersonForConflicts>()
  const deciders = await displayNames(
    tx,
    actor.organizationId,
    rows.map((r) => r.claim.decidedByEmploymentId),
  )

  return rows.map(({ claim, shift, displayName, jobRoleName }) => {
    const location = locationMap.get(shift.locationId)!
    const label = formatShift(shift.startsAt, shift.endsAt, location.timeZone)
    const person = context.get(claim.employmentId)
    const conflicts =
      claim.status === 'pending' && person
        ? detectConflicts(conflictShift(shift, location.timeZone), person)
        : []
    const started = shift.startsAt.getTime() <= now.getTime()
    return {
      id: claim.id,
      shiftId: shift.id,
      locationId: location.id,
      locationName: location.name,
      shiftLabel: `${label.day}, ${label.time}`,
      jobRoleName,
      employmentId: claim.employmentId,
      displayName,
      note: claim.note,
      status: claim.status === 'pending' && started ? 'expired' : claim.status,
      createdAt: claim.createdAt,
      conflicts: conflicts.map((c) => ({ severity: c.severity, message: c.message })),
      decidedByName: claim.decidedByEmploymentId
        ? (deciders.get(claim.decidedByEmploymentId) ?? null)
        : null,
      decisionNote: claim.decisionNote,
    }
  })
}

export async function decideClaim(
  tx: Tx,
  actor: Actor,
  claimId: string,
  decision: 'approved' | 'declined',
  decisionNote: string,
  now = new Date(),
): Promise<void> {
  const [claim] = await tx
    .select()
    .from(openShiftClaims)
    .where(
      and(
        eq(openShiftClaims.organizationId, actor.organizationId),
        eq(openShiftClaims.id, claimId),
      ),
    )
    .for('update')
  if (!claim) throw new NotFoundError('Request not found')
  const shift = await requireShift(tx, actor.organizationId, claim.shiftId)
  const location = await requireLocationCapability(tx, actor, shift.locationId, 'openshift.manage')
  if (isSelf(actor, claim.employmentId)) {
    throw new ForbiddenError('openshift.manage', 'Someone else needs to decide your own request.')
  }
  if (claim.status !== 'pending')
    throw new ValidationError({}, 'This request has already been decided or withdrawn.')
  const label = formatShift(shift.startsAt, shift.endsAt, location.timeZone)
  const names = await displayNames(tx, actor.organizationId, [claim.employmentId])
  const who = names.get(claim.employmentId) ?? 'someone'

  if (decision === 'approved') {
    if (shift.startsAt.getTime() <= now.getTime())
      throw new ValidationError({}, 'This shift has already started.')
    const people = await loadConflictPeople(tx, actor.organizationId, [claim.employmentId], {
      from: shift.startsAt,
      to: shift.endsAt,
    })
    const conflicts = detectConflicts(
      conflictShift(shift, location.timeZone),
      people.get(claim.employmentId)!,
    )
    if (hasBlockingConflict(conflicts)) {
      throw new ValidationError({}, conflicts.find((c) => c.severity === 'block')!.message)
    }
    try {
      await tx.transaction(async (sp) => {
        await reassignNow(sp, actor.organizationId, {
          shiftId: shift.id,
          from: null,
          to: claim.employmentId,
          expectedVersion: shift.version,
          actorEmploymentId: actor.employmentId,
          now,
        })
      })
    } catch (error) {
      if (error instanceof StaleShiftError)
        throw new ValidationError({}, 'This shift has already been filled or changed.')
      if (pgErrorCode(error) === EXCLUSION_VIOLATION)
        throw new ValidationError({}, `${who} is already on a shift that overlaps this one.`)
      throw error
    }
  }

  await tx
    .update(openShiftClaims)
    .set({
      status: decision,
      decidedByEmploymentId: actor.employmentId,
      decidedAt: now,
      decisionNote: note(decisionNote),
      updatedAt: now,
    })
    .where(
      and(
        eq(openShiftClaims.organizationId, actor.organizationId),
        eq(openShiftClaims.id, claimId),
      ),
    )

  const declinedOthers =
    decision === 'approved'
      ? await tx
          .update(openShiftClaims)
          .set({
            status: 'declined',
            decidedByEmploymentId: actor.employmentId,
            decidedAt: now,
            decisionNote: 'Someone else was given this shift.',
            updatedAt: now,
          })
          .where(
            and(
              eq(openShiftClaims.organizationId, actor.organizationId),
              eq(openShiftClaims.shiftId, shift.id),
              eq(openShiftClaims.status, 'pending'),
            ),
          )
          .returning({ id: openShiftClaims.id, employmentId: openShiftClaims.employmentId })
      : []

  await recordAuditEvent(tx, actor, {
    action:
      decision === 'approved'
        ? AUDIT_ACTIONS.OPEN_SHIFT_CLAIM_APPROVED
        : AUDIT_ACTIONS.OPEN_SHIFT_CLAIM_DECLINED,
    summary: `${decision === 'approved' ? 'Gave' : 'Declined'} ${who}${decision === 'approved' ? ' the' : "'s request for the"} open shift on ${label.day}, ${label.time}`,
    subjectType: 'shift',
    subjectId: shift.id,
    locationId: location.id,
    metadata: { claimId, declinedOthers: declinedOthers.length },
  })

  const shiftLabel = `${label.day}, ${label.time}`
  await notifySchedulePeople(
    tx,
    actor.organizationId,
    [
      {
        employmentId: claim.employmentId,
        subjectType: 'open_shift_claim',
        subjectId: claim.id,
        title:
          decision === 'approved'
            ? `The shift is yours: ${shiftLabel}`
            : `Open shift went to someone else: ${shiftLabel}`,
        preview: note(decisionNote) || `${location.name}`,
        href: '/my/schedule',
        purpose: decision,
      },
      ...declinedOthers.map((other) => ({
        employmentId: other.employmentId,
        subjectType: 'open_shift_claim' as const,
        subjectId: other.id,
        title: `Open shift went to someone else: ${shiftLabel}`,
        preview: location.name,
        href: '/my/schedule',
        purpose: 'declined',
      })),
    ],
    now,
  )
}

// ---------------------------------------------------------------------------
// Swaps
// ---------------------------------------------------------------------------

export interface SwapInput {
  shiftId: string
  recipientEmploymentId: string
  kind: SwapKind
  recipientShiftId: string | null
  note: string
}

/** A shift an employee holds and was told about, not yet started. */
async function requireOwnPublishedShift(
  tx: Tx,
  organizationId: string,
  shiftId: string,
  employmentId: string,
  now: Date,
) {
  const shift = await requireShift(tx, organizationId, shiftId)
  const theirs =
    shift.publishedAt !== null &&
    shift.publishedStatus === 'active' &&
    shift.status === 'active' &&
    shift.publishedAssigneeEmploymentId === employmentId &&
    shift.assigneeEmploymentId === employmentId
  if (!theirs) return null
  if (shift.startsAt.getTime() <= now.getTime()) return null
  return shift
}

export async function requestSwap(
  tx: Tx,
  actor: Actor,
  input: SwapInput,
  now = new Date(),
): Promise<string> {
  const shift = await requireOwnPublishedShift(
    tx,
    actor.organizationId,
    input.shiftId,
    actor.employmentId,
    now,
  )
  if (!shift) throw new NotFoundError('Shift not found')
  const location = await requireLocation(tx, actor.organizationId, shift.locationId)

  if (input.recipientEmploymentId === actor.employmentId)
    throw new ValidationError({}, 'Choose a colleague.')
  const recipientLocations = await personLocationIds(
    tx,
    actor.organizationId,
    input.recipientEmploymentId,
  )
  if (!recipientLocations.includes(shift.locationId)) {
    throw new ValidationError(
      { recipientEmploymentId: ['Choose someone who works at this location.'] },
      'That colleague does not work here.',
    )
  }

  let recipientShift: Awaited<ReturnType<typeof requireOwnPublishedShift>> = null
  if (input.kind === 'trade') {
    if (!input.recipientShiftId)
      throw new ValidationError(
        { recipientShiftId: ['Choose which of their shifts you would take.'] },
        'Choose a shift to trade for.',
      )
    recipientShift = await requireOwnPublishedShift(
      tx,
      actor.organizationId,
      input.recipientShiftId,
      input.recipientEmploymentId,
      now,
    )
    if (!recipientShift || !actor.locationIds.includes(recipientShift.locationId)) {
      throw new ValidationError(
        { recipientShiftId: ['That shift is not available to trade.'] },
        'That shift is not available to trade.',
      )
    }
  }

  // Would each side be able to work what they would receive?
  const ids = [actor.employmentId, input.recipientEmploymentId]
  const people = await loadConflictPeople(tx, actor.organizationId, ids, {
    from: new Date(
      Math.min(shift.startsAt.getTime(), recipientShift?.startsAt.getTime() ?? Infinity),
    ),
    to: new Date(Math.max(shift.endsAt.getTime(), recipientShift?.endsAt.getTime() ?? 0)),
  })
  const givenAway = [shift.id, ...(recipientShift ? [recipientShift.id] : [])]
  const recipient = people.get(input.recipientEmploymentId)
  if (!recipient || recipient.status !== 'active')
    throw new ValidationError({}, 'That colleague is not available.')
  const recipientConflicts = detectConflicts(
    conflictShift(shift, location.timeZone),
    withoutShifts(recipient, givenAway),
  )
  if (hasBlockingConflict(recipientConflicts)) {
    throw new ValidationError({}, recipientConflicts.find((c) => c.severity === 'block')!.message)
  }
  if (recipientShift) {
    const theirLocation = await requireLocation(tx, actor.organizationId, recipientShift.locationId)
    const mine = detectConflicts(
      conflictShift(recipientShift, theirLocation.timeZone),
      withoutShifts(people.get(actor.employmentId)!, givenAway),
    )
    if (hasBlockingConflict(mine)) {
      throw new ValidationError(
        {},
        toSecondPerson(mine.find((c) => c.severity === 'block')!.message, actor.displayName),
      )
    }
  }

  const id = newId()
  try {
    await tx.transaction(async (sp) => {
      await sp.insert(shiftSwapRequests).values({
        id,
        organizationId: actor.organizationId,
        kind: input.kind,
        shiftId: shift.id,
        shiftVersion: shift.version,
        requesterEmploymentId: actor.employmentId,
        recipientEmploymentId: input.recipientEmploymentId,
        recipientShiftId: recipientShift?.id ?? null,
        recipientShiftVersion: recipientShift?.version ?? null,
        note: note(input.note),
      })
    })
  } catch (error) {
    if (pgErrorCode(error) === UNIQUE_VIOLATION) {
      throw new ValidationError({}, 'There is already a swap in progress for this shift.')
    }
    throw error
  }

  const label = formatShift(shift.startsAt, shift.endsAt, location.timeZone)
  const names = await displayNames(tx, actor.organizationId, [input.recipientEmploymentId])
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.SWAP_REQUESTED,
    summary: `Asked ${names.get(input.recipientEmploymentId) ?? 'a colleague'} to ${input.kind === 'trade' ? 'trade' : 'take'} the shift on ${label.day}, ${label.time}`,
    subjectType: 'shift_swap',
    subjectId: id,
    locationId: location.id,
    metadata: { kind: input.kind, shiftId: shift.id },
  })
  await notifySchedulePeople(
    tx,
    actor.organizationId,
    [
      {
        employmentId: input.recipientEmploymentId,
        subjectType: 'shift_swap',
        subjectId: id,
        title:
          input.kind === 'trade'
            ? `${actor.displayName} wants to trade shifts with you`
            : `${actor.displayName} asked you to take a shift`,
        preview: `${label.day}, ${label.time} at ${location.name}`,
        href: '/my/schedule#swaps',
        purpose: 'requested',
      },
    ],
    now,
  )
  return id
}

async function requireSwap(tx: Tx, organizationId: string, requestId: string, lock = false) {
  const query = tx
    .select()
    .from(shiftSwapRequests)
    .where(
      and(
        eq(shiftSwapRequests.organizationId, organizationId),
        eq(shiftSwapRequests.id, requestId),
      ),
    )
  const [row] = lock ? await query.for('update') : await query
  if (!row) throw new NotFoundError('Swap request not found')
  return row
}

export async function respondToSwap(
  tx: Tx,
  actor: Actor,
  requestId: string,
  accept: boolean,
  now = new Date(),
): Promise<void> {
  const request = await requireSwap(tx, actor.organizationId, requestId)
  if (request.recipientEmploymentId !== actor.employmentId)
    throw new NotFoundError('Swap request not found')
  const rows = await tx
    .update(shiftSwapRequests)
    .set({
      status: accept ? 'pending_manager' : 'declined',
      recipientRespondedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(shiftSwapRequests.organizationId, actor.organizationId),
        eq(shiftSwapRequests.id, requestId),
        eq(shiftSwapRequests.status, 'pending_recipient'),
      ),
    )
    .returning({ id: shiftSwapRequests.id })
  if (rows.length === 0) throw new ValidationError({}, 'This request is no longer waiting for you.')

  const shift = await requireShift(tx, actor.organizationId, request.shiftId)
  const location = await requireLocation(tx, actor.organizationId, shift.locationId)
  const label = formatShift(shift.startsAt, shift.endsAt, location.timeZone)
  await recordAuditEvent(tx, actor, {
    action: accept ? AUDIT_ACTIONS.SWAP_ACCEPTED : AUDIT_ACTIONS.SWAP_DECLINED,
    summary: `${accept ? 'Agreed to' : 'Declined'} the swap for ${label.day}, ${label.time}${accept ? '. Waiting for a manager.' : ''}`,
    subjectType: 'shift_swap',
    subjectId: requestId,
    locationId: location.id,
  })
  await notifySchedulePeople(
    tx,
    actor.organizationId,
    [
      {
        employmentId: request.requesterEmploymentId,
        subjectType: 'shift_swap',
        subjectId: requestId,
        title: accept
          ? `${actor.displayName} agreed to your swap. A manager will confirm it.`
          : `${actor.displayName} can't take your shift`,
        preview: `${label.day}, ${label.time}`,
        href: '/my/schedule#swaps',
        purpose: accept ? 'accepted' : 'declined',
      },
    ],
    now,
  )
}

export async function cancelSwap(
  tx: Tx,
  actor: Actor,
  requestId: string,
  now = new Date(),
): Promise<void> {
  const request = await requireSwap(tx, actor.organizationId, requestId)
  if (request.requesterEmploymentId !== actor.employmentId)
    throw new NotFoundError('Swap request not found')
  const rows = await tx
    .update(shiftSwapRequests)
    .set({ status: 'cancelled', updatedAt: now })
    .where(
      and(
        eq(shiftSwapRequests.organizationId, actor.organizationId),
        eq(shiftSwapRequests.id, requestId),
        inArray(shiftSwapRequests.status, ['pending_recipient', 'pending_manager']),
      ),
    )
    .returning({ id: shiftSwapRequests.id })
  if (rows.length === 0) throw new ValidationError({}, 'This request is no longer open.')
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.SWAP_CANCELLED,
    summary: 'Withdrew their shift swap request',
    subjectType: 'shift_swap',
    subjectId: requestId,
  })
}

export interface SwapReview {
  id: string
  kind: string
  status: string
  locationId: string
  locationName: string
  requesterName: string
  recipientName: string
  shiftLabel: string
  recipientShiftLabel: string | null
  note: string
  createdAt: Date
  recipientRespondedAt: Date | null
  decidedByName: string | null
  decisionNote: string
  conflicts: string[]
  stale: boolean
}

export async function listSwapsForReview(
  tx: Tx,
  actor: Actor,
  options: { status?: 'pending' | 'decided' } = {},
  now = new Date(),
): Promise<SwapReview[]> {
  const scope = accessibleLocationIds(actor, 'swap.decide')
  if (scope !== null && scope.length === 0) return []
  const rows = await tx
    .select({ request: shiftSwapRequests, shift: shifts })
    .from(shiftSwapRequests)
    .innerJoin(
      shifts,
      and(
        eq(shifts.organizationId, shiftSwapRequests.organizationId),
        eq(shifts.id, shiftSwapRequests.shiftId),
      ),
    )
    .where(
      and(
        eq(shiftSwapRequests.organizationId, actor.organizationId),
        scope === null ? undefined : inArray(shifts.locationId, scope),
        options.status === 'pending'
          ? eq(shiftSwapRequests.status, 'pending_manager')
          : options.status === 'decided'
            ? inArray(shiftSwapRequests.status, ['approved', 'denied', 'expired'])
            : ne(shiftSwapRequests.status, 'cancelled'),
      ),
    )
    .orderBy(asc(shifts.startsAt))
    .limit(200)

  const recipientShiftIds = rows
    .map((r) => r.request.recipientShiftId)
    .filter((id): id is string => !!id)
  const recipientShifts = recipientShiftIds.length
    ? await tx
        .select()
        .from(shifts)
        .where(
          and(
            eq(shifts.organizationId, actor.organizationId),
            inArray(shifts.id, recipientShiftIds),
          ),
        )
    : []
  const locationMap = await loadLocations(tx, actor.organizationId)
  const names = await displayNames(
    tx,
    actor.organizationId,
    rows.flatMap((r) => [
      r.request.requesterEmploymentId,
      r.request.recipientEmploymentId,
      r.request.decidedByEmploymentId,
    ]),
  )

  const pending = rows.filter((r) => r.request.status === 'pending_manager')
  const context = pending.length
    ? await loadConflictPeople(
        tx,
        actor.organizationId,
        pending.flatMap((r) => [r.request.requesterEmploymentId, r.request.recipientEmploymentId]),
        {
          from: new Date(Math.min(...pending.map((r) => r.shift.startsAt.getTime()))),
          to: new Date(Math.max(...pending.map((r) => r.shift.endsAt.getTime()))),
        },
      )
    : new Map<string, PersonForConflicts>()

  return rows.map(({ request, shift }) => {
    const location = locationMap.get(shift.locationId)!
    const label = formatShift(shift.startsAt, shift.endsAt, location.timeZone)
    const theirShift = recipientShifts.find((s) => s.id === request.recipientShiftId) ?? null
    const theirLocation = theirShift ? locationMap.get(theirShift.locationId)! : null
    const theirLabel =
      theirShift && theirLocation
        ? formatShift(theirShift.startsAt, theirShift.endsAt, theirLocation.timeZone)
        : null

    const stale =
      shift.version !== request.shiftVersion ||
      shift.assigneeEmploymentId !== request.requesterEmploymentId ||
      shift.startsAt.getTime() <= now.getTime() ||
      (theirShift !== null &&
        (theirShift.version !== request.recipientShiftVersion ||
          theirShift.assigneeEmploymentId !== request.recipientEmploymentId))

    const conflicts: string[] = []
    if (request.status === 'pending_manager' && !stale) {
      const givenAway = [shift.id, ...(theirShift ? [theirShift.id] : [])]
      const recipient = context.get(request.recipientEmploymentId)
      if (recipient) {
        conflicts.push(
          ...detectConflicts(
            conflictShift(shift, location.timeZone),
            withoutShifts(recipient, givenAway),
          ).map((c) => c.message),
        )
      }
      const requester = context.get(request.requesterEmploymentId)
      if (theirShift && theirLocation && requester) {
        conflicts.push(
          ...detectConflicts(
            conflictShift(theirShift, theirLocation.timeZone),
            withoutShifts(requester, givenAway),
          ).map((c) => c.message),
        )
      }
    }

    return {
      id: request.id,
      kind: request.kind,
      status: request.status,
      locationId: location.id,
      locationName: location.name,
      requesterName: names.get(request.requesterEmploymentId) ?? 'Someone',
      recipientName: names.get(request.recipientEmploymentId) ?? 'Someone',
      shiftLabel: `${label.day}, ${label.time}`,
      recipientShiftLabel: theirLabel ? `${theirLabel.day}, ${theirLabel.time}` : null,
      note: request.note,
      createdAt: request.createdAt,
      recipientRespondedAt: request.recipientRespondedAt,
      decidedByName: request.decidedByEmploymentId
        ? (names.get(request.decidedByEmploymentId) ?? null)
        : null,
      decisionNote: request.decisionNote,
      conflicts,
      stale,
    }
  })
}

export type SwapDecisionResult = 'approved' | 'denied' | 'expired'

/**
 * A manager's decision on a swap both colleagues have agreed to.
 *
 * Concurrency, in three layers:
 *   1. The request row is locked FOR UPDATE, so two managers deciding the same
 *      request serialize and the second finds it already decided.
 *   2. Each shift moves only if its version and assignee are still what the
 *      colleagues agreed to. If another approval moved it first, this request
 *      is closed as EXPIRED - the shift they agreed about no longer exists as
 *      it was - and nothing moves.
 *   3. The exclusion constraint refuses a double booking even if both of the
 *      above were somehow bypassed.
 */
export async function decideSwap(
  tx: Tx,
  actor: Actor,
  requestId: string,
  decision: 'approved' | 'denied',
  decisionNote: string,
  now = new Date(),
): Promise<SwapDecisionResult> {
  const request = await requireSwap(tx, actor.organizationId, requestId, true)
  const shift = await requireShift(tx, actor.organizationId, request.shiftId)
  const location = await requireLocationCapability(tx, actor, shift.locationId, 'swap.decide')
  if (
    isSelf(actor, request.requesterEmploymentId) ||
    isSelf(actor, request.recipientEmploymentId)
  ) {
    throw new ForbiddenError('swap.decide', 'Someone else needs to decide a swap you are part of.')
  }
  if (request.status !== 'pending_manager') {
    throw new ValidationError(
      {},
      request.status === 'pending_recipient'
        ? 'The colleague has not agreed to this swap yet.'
        : 'This swap has already been decided or withdrawn.',
    )
  }

  const label = formatShift(shift.startsAt, shift.endsAt, location.timeZone)
  const names = await displayNames(tx, actor.organizationId, [
    request.requesterEmploymentId,
    request.recipientEmploymentId,
  ])
  const requester = names.get(request.requesterEmploymentId) ?? 'Someone'
  const recipient = names.get(request.recipientEmploymentId) ?? 'someone'

  const close = async (status: SwapDecisionResult, closingNote: string) => {
    await tx
      .update(shiftSwapRequests)
      .set({
        status,
        decidedByEmploymentId: actor.employmentId,
        decidedAt: now,
        decisionNote: closingNote,
        updatedAt: now,
      })
      .where(
        and(
          eq(shiftSwapRequests.organizationId, actor.organizationId),
          eq(shiftSwapRequests.id, requestId),
        ),
      )
  }
  const tell = async (title: string, preview: string, purpose: string) => {
    await notifySchedulePeople(
      tx,
      actor.organizationId,
      [request.requesterEmploymentId, request.recipientEmploymentId].map((employmentId) => ({
        employmentId,
        subjectType: 'shift_swap' as const,
        subjectId: requestId,
        title,
        preview,
        href: '/my/schedule',
        purpose,
      })),
      now,
    )
  }

  if (decision === 'denied') {
    await close('denied', note(decisionNote))
    await recordAuditEvent(tx, actor, {
      action: AUDIT_ACTIONS.SWAP_DENIED,
      summary: `Denied the swap of ${label.day}, ${label.time} from ${requester} to ${recipient}`,
      subjectType: 'shift_swap',
      subjectId: requestId,
      locationId: location.id,
    })
    await tell(
      `Shift swap not approved: ${label.day}, ${label.time}`,
      note(decisionNote) || 'The schedule stays as it was.',
      'denied',
    )
    return 'denied'
  }

  const theirShift = request.recipientShiftId
    ? await requireShift(tx, actor.organizationId, request.recipientShiftId)
    : null
  const theirLocation = theirShift
    ? await requireLocation(tx, actor.organizationId, theirShift.locationId)
    : null

  if (
    shift.startsAt.getTime() <= now.getTime() ||
    (theirShift && theirShift.startsAt.getTime() <= now.getTime())
  ) {
    await close('expired', 'The shift started before the swap was decided.')
    await recordAuditEvent(tx, actor, {
      action: AUDIT_ACTIONS.SWAP_EXPIRED,
      summary: `A swap for ${label.day}, ${label.time} expired: the shift had already started`,
      subjectType: 'shift_swap',
      subjectId: requestId,
      locationId: location.id,
    })
    return 'expired'
  }

  // Conflicts on the up-to-date picture. A block leaves the request pending
  // so the manager can deny it with a reason.
  const givenAway = [shift.id, ...(theirShift ? [theirShift.id] : [])]
  const people = await loadConflictPeople(
    tx,
    actor.organizationId,
    [request.requesterEmploymentId, request.recipientEmploymentId],
    {
      from: new Date(
        Math.min(shift.startsAt.getTime(), theirShift?.startsAt.getTime() ?? Infinity),
      ),
      to: new Date(Math.max(shift.endsAt.getTime(), theirShift?.endsAt.getTime() ?? 0)),
    },
  )
  const blocks = [
    ...detectConflicts(
      conflictShift(shift, location.timeZone),
      withoutShifts(people.get(request.recipientEmploymentId)!, givenAway),
    ),
    ...(theirShift && theirLocation
      ? detectConflicts(
          conflictShift(theirShift, theirLocation.timeZone),
          withoutShifts(people.get(request.requesterEmploymentId)!, givenAway),
        )
      : []),
  ].filter((c) => c.severity === 'block')
  if (blocks.length > 0) throw new ValidationError({}, blocks[0]!.message)

  try {
    await tx.transaction(async (sp) => {
      // A trade moves two assignments; check the double-booking rule once
      // both have moved, not in between.
      await sp.execute(sql`set constraints shifts_no_double_booking deferred`)
      await reassignNow(sp, actor.organizationId, {
        shiftId: shift.id,
        from: request.requesterEmploymentId,
        to: request.recipientEmploymentId,
        expectedVersion: request.shiftVersion,
        actorEmploymentId: actor.employmentId,
        now,
      })
      if (theirShift) {
        await reassignNow(sp, actor.organizationId, {
          shiftId: theirShift.id,
          from: request.recipientEmploymentId,
          to: request.requesterEmploymentId,
          expectedVersion: request.recipientShiftVersion ?? -1,
          actorEmploymentId: actor.employmentId,
          now,
        })
      }
      await sp.execute(sql`set constraints shifts_no_double_booking immediate`)
    })
  } catch (error) {
    if (error instanceof StaleShiftError) {
      await close('expired', 'The shift changed after this swap was agreed, so it was not applied.')
      await recordAuditEvent(tx, actor, {
        action: AUDIT_ACTIONS.SWAP_EXPIRED,
        summary: `A swap for ${label.day}, ${label.time} was not applied: the shift had changed since it was agreed`,
        subjectType: 'shift_swap',
        subjectId: requestId,
        locationId: location.id,
      })
      await tell(
        `Shift swap could not go ahead: ${label.day}, ${label.time}`,
        'The shift changed after you agreed the swap. Ask again if you still want to.',
        'expired',
      )
      return 'expired'
    }
    if (pgErrorCode(error) === EXCLUSION_VIOLATION) {
      throw new ValidationError({}, 'This swap would put someone on two overlapping shifts.')
    }
    throw error
  }

  await close('approved', note(decisionNote))
  // Anything else still in progress for these shifts is about a shift that has now moved.
  await tx
    .update(shiftSwapRequests)
    .set({
      status: 'expired',
      decisionNote: 'The shift was swapped in another request.',
      decidedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(shiftSwapRequests.organizationId, actor.organizationId),
        ne(shiftSwapRequests.id, requestId),
        inArray(shiftSwapRequests.status, ['pending_recipient', 'pending_manager']),
        or(
          inArray(shiftSwapRequests.shiftId, givenAway),
          inArray(shiftSwapRequests.recipientShiftId, givenAway),
        ),
      ),
    )

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.SWAP_APPROVED,
    summary:
      request.kind === 'trade' && theirShift && theirLocation
        ? `Approved a trade: ${requester} and ${recipient} swapped ${label.day}, ${label.time} for ${formatShift(theirShift.startsAt, theirShift.endsAt, theirLocation.timeZone).day}`
        : `Approved ${recipient} taking ${requester}'s shift on ${label.day}, ${label.time}`,
    subjectType: 'shift_swap',
    subjectId: requestId,
    locationId: location.id,
    metadata: { kind: request.kind, shiftId: shift.id, recipientShiftId: theirShift?.id ?? null },
  })
  await tell(
    `Shift swap approved: ${label.day}, ${label.time}`,
    'Your schedule has been updated.',
    'approved',
  )
  return 'approved'
}

// ---------------------------------------------------------------------------
// Counts for navigation
// ---------------------------------------------------------------------------

export async function pendingRequestCounts(
  tx: Tx,
  actor: Actor,
): Promise<{ timeOff: number; claims: number; swaps: number }> {
  const [timeOff, claims, swaps] = await Promise.all([
    can(actor, 'timeoff.decide') || accessibleLocationIds(actor, 'timeoff.decide')?.length !== 0
      ? listTimeOffForReview(tx, actor, { status: 'pending' }).then((r) => r.length)
      : Promise.resolve(0),
    listClaimsForReview(tx, actor, { status: 'pending' }).then(
      (r) => r.filter((c) => c.status === 'pending').length,
    ),
    listSwapsForReview(tx, actor, { status: 'pending' }).then((r) => r.length),
  ])
  return { timeOff, claims, swaps }
}
