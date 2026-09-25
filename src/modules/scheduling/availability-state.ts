import { addCalendarDays } from '@/lib/dates'
import { MINUTES_PER_DAY, isoWeekday, localDateOf, localTimeToInstant, overlaps } from './time'
import { timeOffPeriod, type PersonForConflicts, type ShiftForConflicts } from './conflicts'

/**
 * THE FOUR STATES A MANAGER SEES.
 *
 * Slotted puts one of four words next to every name, and the whole scheduling
 * interface is coloured by it. They are derived, not stored: three of them
 * come from what the person declared in `availability_rules`, and the fourth
 * from an approved row in `time_off_requests`.
 *
 *   available       can work, and prefers this shift   (stored 'preferred')
 *   not_preferred   can work, would rather not         (stored 'available')
 *   unavailable     said no - a manager may override, with a warning
 *   time_off        approved time off - LOCKED, no override exists
 *
 * A pure function, so the picker, autofill, the day editor, the warnings and
 * the call-out list all answer the same way and there is no second copy of the
 * rule to drift. Dated exceptions replace the weekly pattern for their day,
 * which is what makes "I cannot do next Tuesday" work without rewriting the
 * week.
 */

export type AvailabilityState = 'available' | 'not_preferred' | 'unavailable' | 'time_off'

export const AVAILABILITY_LABELS: Record<AvailabilityState, string> = {
  available: 'Available',
  not_preferred: 'Not preferred',
  unavailable: 'Unavailable',
  time_off: 'Approved time off',
}

export const AVAILABILITY_EXPLANATIONS: Record<AvailabilityState, string> = {
  available: 'Can work, and prefers this shift.',
  not_preferred: 'Can work, but would rather not.',
  unavailable: 'Said no. You can override it — with a warning before publishing.',
  time_off: 'Locked. Can never be scheduled, and there is no override.',
}

/** The order a manager wants to see people in. Lower sorts first. */
export const AVAILABILITY_RANK: Record<AvailabilityState, number> = {
  available: 0,
  not_preferred: 1,
  unavailable: 2,
  time_off: 3,
}

interface Window {
  startMinute: number
  endMinute: number
  preference: string
}

/**
 * The declared windows for one local date: a dated exception replaces the
 * weekly pattern entirely for that day, so "off next Tuesday" does not have to
 * argue with "Tuesdays 9-5".
 */
function windowsOn(
  date: string,
  person: Pick<PersonForConflicts, 'availabilityRules' | 'availabilityExceptions'>,
): Window[] {
  const exceptions = person.availabilityExceptions.filter((e) => e.onDate === date)
  if (exceptions.length > 0) {
    return exceptions.map((e) => ({
      startMinute: e.startMinute ?? 0,
      endMinute: e.endMinute ?? MINUTES_PER_DAY,
      preference: e.preference,
    }))
  }
  return person.availabilityRules
    .filter((r) => r.weekday === isoWeekday(date))
    .map((r) => ({ startMinute: r.startMinute, endMinute: r.endMinute, preference: r.preference }))
}

export function availabilityStateFor(
  shift: Pick<ShiftForConflicts, 'startsAt' | 'endsAt' | 'timeZone'>,
  person: Pick<PersonForConflicts, 'availabilityRules' | 'availabilityExceptions' | 'timeOff'>,
): AvailabilityState {
  // Approved time off first, and it ends the question.
  for (const request of person.timeOff) {
    if (request.status !== 'approved') continue
    const period = timeOffPeriod(request, shift.timeZone)
    if (period && overlaps(shift.startsAt, shift.endsAt, period.start, period.end))
      return 'time_off'
  }

  const lastDate = localDateOf(new Date(shift.endsAt.getTime() - 1), shift.timeZone)
  let sawPreferred = false
  let sawAvailable = false
  let sawAnyRule = false

  for (
    let date = localDateOf(shift.startsAt, shift.timeZone);
    date <= lastDate;
    date = addCalendarDays(date, 1)
  ) {
    for (const window of windowsOn(date, person)) {
      sawAnyRule = true
      const start = localTimeToInstant(date, window.startMinute, shift.timeZone)
      const end = localTimeToInstant(date, window.endMinute, shift.timeZone)
      if (!start || !end || !overlaps(shift.startsAt, shift.endsAt, start, end)) continue
      // One "no" anywhere in the shift makes the whole shift a no.
      if (window.preference === 'unavailable') return 'unavailable'
      if (window.preference === 'preferred') sawPreferred = true
      if (window.preference === 'available') sawAvailable = true
    }
  }

  if (sawPreferred) return 'available'
  if (sawAvailable) return 'not_preferred'
  // Somebody who declared a pattern and did not include these hours has, in
  // effect, said "I would rather not". Somebody who declared nothing at all
  // has said nothing, and is not held to a preference they never expressed.
  return sawAnyRule ? 'not_preferred' : 'available'
}
