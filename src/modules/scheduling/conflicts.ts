import { addCalendarDays } from '@/lib/dates'
import {
  MINUTES_PER_DAY,
  isoWeekday,
  localDateOf,
  localTimeToInstant,
  overlaps,
  paidMinutes,
  weekStartOf,
} from './time'

/*
 * CONFLICT DETECTION.
 *
 * A pure function: given a shift and everything known about one person, what
 * is wrong with putting them on it? No database, so every rule below is
 * exhaustively unit-tested, and the same function answers the assignment
 * picker, the publish check, open-shift claims and swap approvals - there is
 * no second copy of the rules to drift.
 *
 * Two severities, and the difference is a product promise:
 *
 *   BLOCK  The assignment would be false. Nobody can work two overlapping
 *          shifts, be on approved time off, or work somewhere they are not
 *          assigned. These refuse assignment and refuse publication.
 *   WARN   A manager should know, and may still decide. Declared
 *          unavailability, time off not yet decided, a missing job role,
 *          a short turnaround, a long week.
 *
 * The rest and weekly-hours thresholds are organization defaults for the
 * warning, NOT labour-law rules. EverCalm does not encode jurisdiction-specific
 * working-time law; see docs/permissions.md.
 *
 * Every comparison happens at the SHIFT's location, in its timezone: time off
 * "on the 15th" and availability "Tuesdays after 5pm" are wall-clock
 * statements about where the person works.
 */

export type ConflictSeverity = 'block' | 'warn'

export type ConflictKind =
  | 'inactive'
  | 'not_at_location'
  | 'overlap'
  | 'time_off_approved'
  | 'time_off_pending'
  | 'unavailable'
  | 'missing_job_role'
  | 'short_rest'
  | 'long_week'

export interface ScheduleConflict {
  kind: ConflictKind
  severity: ConflictSeverity
  message: string
  /** The shift or time-off request the conflict is with, when there is one. */
  relatedId?: string
}

export interface ShiftForConflicts {
  /** Null for a shift that does not exist yet. */
  id: string | null
  startsAt: Date
  endsAt: Date
  breakMinutes: number
  locationId: string
  jobRoleId: string | null
  timeZone: string
}

export interface OtherShift {
  id: string
  startsAt: Date
  endsAt: Date
  breakMinutes: number
}

export interface TimeOffForConflicts {
  id: string
  startsOn: string
  endsOn: string
  /** Both null means whole days. */
  startMinute: number | null
  endMinute: number | null
  status: string
}

export interface AvailabilityRuleForConflicts {
  /** ISO weekday, Monday = 1. */
  weekday: number
  startMinute: number
  endMinute: number
  preference: string
}

export interface AvailabilityExceptionForConflicts {
  onDate: string
  startMinute: number | null
  endMinute: number | null
  preference: string
}

export interface PersonForConflicts {
  employmentId: string
  displayName: string
  status: string
  locationIds: readonly string[]
  jobRoleIds: readonly string[]
  /** Their other ACTIVE assignments, at any location. */
  shifts: readonly OtherShift[]
  timeOff: readonly TimeOffForConflicts[]
  availabilityRules: readonly AvailabilityRuleForConflicts[]
  availabilityExceptions: readonly AvailabilityExceptionForConflicts[]
}

export interface ConflictPolicy {
  /** Warn when the gap between two shifts is shorter than this. */
  minRestMinutes: number
  /** Warn when worked minutes in the shift's local week exceed this. */
  weeklyMinutesWarning: number
}

export const DEFAULT_CONFLICT_POLICY: ConflictPolicy = {
  minRestMinutes: 8 * 60,
  weeklyMinutesWarning: 40 * 60,
}

export function detectConflicts(
  shift: ShiftForConflicts,
  person: PersonForConflicts,
  policy: ConflictPolicy = DEFAULT_CONFLICT_POLICY,
): ScheduleConflict[] {
  const out: ScheduleConflict[] = []
  const name = person.displayName

  if (person.status !== 'active') {
    out.push({ kind: 'inactive', severity: 'block', message: `${name} is not currently active.` })
  }

  if (!person.locationIds.includes(shift.locationId)) {
    out.push({
      kind: 'not_at_location',
      severity: 'block',
      message: `${name} is not assigned to work at this location.`,
    })
  }

  const others = person.shifts.filter((s) => s.id !== shift.id)

  for (const other of others) {
    if (overlaps(shift.startsAt, shift.endsAt, other.startsAt, other.endsAt)) {
      out.push({
        kind: 'overlap',
        severity: 'block',
        message: `${name} is already on a shift that overlaps this one.`,
        relatedId: other.id,
      })
    }
  }

  for (const request of person.timeOff) {
    if (request.status !== 'approved' && request.status !== 'pending') continue
    const period = timeOffPeriod(request, shift.timeZone)
    if (!period || !overlaps(shift.startsAt, shift.endsAt, period.start, period.end)) continue
    out.push(
      request.status === 'approved'
        ? {
            kind: 'time_off_approved',
            severity: 'block',
            message: `${name} has approved time off during this shift.`,
            relatedId: request.id,
          }
        : {
            kind: 'time_off_pending',
            severity: 'warn',
            message: `${name} has asked for time off during this shift and it has not been decided.`,
            relatedId: request.id,
          },
    )
  }

  if (isUnavailable(shift, person)) {
    out.push({
      kind: 'unavailable',
      severity: 'warn',
      message: `${name} said they are unavailable for some or all of this shift.`,
    })
  }

  if (shift.jobRoleId && !person.jobRoleIds.includes(shift.jobRoleId)) {
    out.push({
      kind: 'missing_job_role',
      severity: 'warn',
      message: `${name} does not hold the job role this shift is for.`,
    })
  }

  for (const other of others) {
    if (overlaps(shift.startsAt, shift.endsAt, other.startsAt, other.endsAt)) continue
    const gapBefore = shift.startsAt.getTime() - other.endsAt.getTime()
    const gapAfter = other.startsAt.getTime() - shift.endsAt.getTime()
    const gap = gapBefore >= 0 ? gapBefore : gapAfter
    if (gap >= 0 && gap < policy.minRestMinutes * 60_000) {
      out.push({
        kind: 'short_rest',
        severity: 'warn',
        message: `${name} would have less than ${Math.round(policy.minRestMinutes / 60)} hours between shifts.`,
        relatedId: other.id,
      })
      break
    }
  }

  const week = weekStartOf(localDateOf(shift.startsAt, shift.timeZone))
  const weekMinutes =
    paidMinutes(shift.startsAt, shift.endsAt, shift.breakMinutes) +
    others
      .filter((s) => weekStartOf(localDateOf(s.startsAt, shift.timeZone)) === week)
      .reduce((sum, s) => sum + paidMinutes(s.startsAt, s.endsAt, s.breakMinutes), 0)
  if (weekMinutes > policy.weeklyMinutesWarning) {
    out.push({
      kind: 'long_week',
      severity: 'warn',
      message: `${name} would be scheduled for ${formatHours(weekMinutes)} this week, over ${formatHours(policy.weeklyMinutesWarning)}.`,
    })
  }

  return out
}

export function hasBlockingConflict(conflicts: readonly ScheduleConflict[]): boolean {
  return conflicts.some((c) => c.severity === 'block')
}

/** The instants a time-off request covers, read in a location's timezone. */
export function timeOffPeriod(
  request: Pick<TimeOffForConflicts, 'startsOn' | 'endsOn' | 'startMinute' | 'endMinute'>,
  timeZone: string,
): { start: Date; end: Date } | null {
  const partial = request.startMinute !== null && request.endMinute !== null
  const start = localTimeToInstant(request.startsOn, partial ? request.startMinute! : 0, timeZone)
  const end = partial
    ? localTimeToInstant(request.endsOn, request.endMinute!, timeZone)
    : localTimeToInstant(addCalendarDays(request.endsOn, 1), 0, timeZone)
  if (!start || !end || end.getTime() <= start.getTime()) return null
  return { start, end }
}

/**
 * Does any declared unavailability touch the shift?
 *
 * Checked per local date the shift covers, so an overnight shift is compared
 * with both days. A dated exception REPLACES the weekly pattern for that date:
 * "normally unavailable Tuesdays, but free this Tuesday" is not a conflict.
 */
function isUnavailable(shift: ShiftForConflicts, person: PersonForConflicts): boolean {
  const lastDate = localDateOf(new Date(shift.endsAt.getTime() - 1), shift.timeZone)
  for (
    let date = localDateOf(shift.startsAt, shift.timeZone);
    date <= lastDate;
    date = addCalendarDays(date, 1)
  ) {
    const exceptions = person.availabilityExceptions.filter((e) => e.onDate === date)
    const windows =
      exceptions.length > 0
        ? exceptions
            .filter((e) => e.preference === 'unavailable')
            .map((e) => [e.startMinute ?? 0, e.endMinute ?? MINUTES_PER_DAY] as const)
        : person.availabilityRules
            .filter((r) => r.preference === 'unavailable' && r.weekday === isoWeekday(date))
            .map((r) => [r.startMinute, r.endMinute] as const)

    for (const [startMinute, endMinute] of windows) {
      const start = localTimeToInstant(date, startMinute, shift.timeZone)
      const end = localTimeToInstant(date, endMinute, shift.timeZone)
      if (start && end && overlaps(shift.startsAt, shift.endsAt, start, end)) return true
    }
  }
  return false
}

function formatHours(minutes: number): string {
  const hours = minutes / 60
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hours`
}

/**
 * A conflict message addressed to the person it is about: "Sam is already on
 * a shift" becomes "You are already on a shift".
 */
export function toSecondPerson(message: string, displayName: string): string {
  if (!message.startsWith(displayName)) return message
  const rest = message.slice(displayName.length)
  const swaps: [string, string][] = [
    [' is ', ' are '],
    [' has ', ' have '],
    [' does ', ' do '],
    [' said they are ', ' said you are '],
    [' would ', ' would '],
  ]
  for (const [from, to] of swaps) {
    if (rest.startsWith(from)) return `You${to}${rest.slice(from.length)}`
  }
  return message
}
