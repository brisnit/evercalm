import { addCalendarDays, businessDate, zonedParts, zonedWallTimeToInstant } from '@/lib/dates'

/*
 * SCHEDULING TIME.
 *
 * Every schedule question is asked in a LOCATION's wall-clock time. A shift
 * "from 4pm to 10:30pm on Tuesday" means those clock times where the work
 * happens - Los Angeles for one site, Denver for another - whatever timezone
 * the server or the manager's laptop is in.
 *
 * Shifts are stored as instants (timestamptz). This module is the only place
 * that turns a date and clock times into instants, and it refuses the two
 * inputs that silently corrupt schedules elsewhere:
 *
 *   - a clock time that does not exist (02:30 on the morning clocks spring
 *     forward), rather than quietly moving it an hour
 *   - a zero-length shift
 *
 * An end time at or before the start time means the shift runs past midnight
 * into the next day: 17:00-01:00 is eight hours, not negative sixteen.
 *
 * Pure functions, no database, so every edge is covered by unit tests.
 */

export const MINUTES_PER_DAY = 24 * 60

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

/** A real calendar date in YYYY-MM-DD form. Rejects 2026-02-30. */
export function isIsoDate(value: string): boolean {
  const match = DATE_RE.exec(value)
  if (!match) return false
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

/** "HH:MM" to minutes after midnight. `null` for anything else. */
export function parseTimeOfDay(value: string): number | null {
  const match = TIME_RE.exec(value.trim())
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

/** Minutes after midnight to "HH:MM". 1440 renders as "24:00". */
export function formatTimeOfDay(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** ISO weekday of a calendar date: Monday = 1 ... Sunday = 7. */
export function isoWeekday(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number]
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return day === 0 ? 7 : day
}

/** The Monday that starts the week containing `isoDate`. */
export function weekStartOf(isoDate: string): string {
  return addCalendarDays(isoDate, 1 - isoWeekday(isoDate))
}

/** The seven calendar dates of a week, Monday first. */
export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addCalendarDays(weekStart, i))
}

/** The calendar date an instant falls on at a location. */
export function localDateOf(instant: Date, timeZone: string): string {
  return businessDate(instant, timeZone, 0)
}

/** Minutes after local midnight for an instant, at a location. */
export function localMinuteOf(instant: Date, timeZone: string): number {
  const parts = zonedParts(instant, timeZone)
  return parts.hour * 60 + parts.minute
}

/**
 * The instant a local date and clock time name at a location.
 *
 * `minute` may be 1440, meaning midnight at the END of the date. Returns
 * `null` when that clock time does not exist on that date - it fell inside a
 * daylight-saving gap. When a clock time happens twice (clocks fall back) the
 * first occurrence is used.
 */
export function localTimeToInstant(isoDate: string, minute: number, timeZone: string): Date | null {
  if (!isIsoDate(isoDate) || minute < 0 || minute > MINUTES_PER_DAY) return null
  if (minute === MINUTES_PER_DAY)
    return localTimeToInstant(addCalendarDays(isoDate, 1), 0, timeZone)

  const instant = zonedWallTimeToInstant(`${isoDate}T${formatTimeOfDay(minute)}`, timeZone)
  if (!instant) return null

  // Round trip: a non-existent wall time comes back as a different clock time.
  const back = zonedParts(instant, timeZone)
  const sameDate =
    `${String(back.year).padStart(4, '0')}-${String(back.month).padStart(2, '0')}-${String(back.day).padStart(2, '0')}` ===
    isoDate
  if (!sameDate || back.hour * 60 + back.minute !== minute) return null
  return instant
}

export type ShiftTimes =
  | { ok: true; startsAt: Date; endsAt: Date; overnight: boolean }
  | { ok: false; reason: 'invalid' | 'same_time' | 'nonexistent_start' | 'nonexistent_end' }

/**
 * A shift's instants from its local date and clock times.
 *
 * An end clock time earlier than (or equal to midnight relative to) the start
 * means the shift ends on the following date.
 */
export function shiftInstants(
  isoDate: string,
  startMinute: number,
  endMinute: number,
  timeZone: string,
): ShiftTimes {
  if (
    !isIsoDate(isoDate) ||
    !Number.isInteger(startMinute) ||
    !Number.isInteger(endMinute) ||
    startMinute < 0 ||
    startMinute >= MINUTES_PER_DAY ||
    endMinute < 0 ||
    endMinute >= MINUTES_PER_DAY
  ) {
    return { ok: false, reason: 'invalid' }
  }
  if (startMinute === endMinute) return { ok: false, reason: 'same_time' }

  const overnight = endMinute < startMinute
  const startsAt = localTimeToInstant(isoDate, startMinute, timeZone)
  if (!startsAt) return { ok: false, reason: 'nonexistent_start' }
  const endsAt = localTimeToInstant(
    overnight ? addCalendarDays(isoDate, 1) : isoDate,
    endMinute,
    timeZone,
  )
  if (!endsAt) return { ok: false, reason: 'nonexistent_end' }
  return { ok: true, startsAt, endsAt, overnight }
}

/** Human explanation for a refused set of shift times. */
export function shiftTimesProblem(reason: Exclude<ShiftTimes, { ok: true }>['reason']): string {
  switch (reason) {
    case 'invalid':
      return 'Enter a date and start and end times.'
    case 'same_time':
      return 'A shift needs to end at a different time from when it starts.'
    case 'nonexistent_start':
      return 'That start time does not exist on this date because the clocks change. Choose another time.'
    case 'nonexistent_end':
      return 'That end time does not exist on this date because the clocks change. Choose another time.'
  }
}

/** Worked minutes: elapsed time (which a DST change can lengthen or shorten) less the break. */
export function paidMinutes(startsAt: Date, endsAt: Date, breakMinutes: number): number {
  const elapsed = Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000)
  return Math.max(0, elapsed - Math.max(0, breakMinutes))
}

/** Half-open interval overlap: a shift ending at 16:00 does not overlap one starting at 16:00. */
export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime()
}

const DAY_FORMAT = new Map<string, Intl.DateTimeFormat>()
const TIME_FORMAT = new Map<string, Intl.DateTimeFormat>()

function dayFormat(timeZone: string): Intl.DateTimeFormat {
  let f = DAY_FORMAT.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })
    DAY_FORMAT.set(timeZone, f)
  }
  return f
}

function timeFormat(timeZone: string): Intl.DateTimeFormat {
  let f = TIME_FORMAT.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' })
    TIME_FORMAT.set(timeZone, f)
  }
  return f
}

/** "Tue, Sep 15" for a calendar date, independent of any timezone. */
export function formatIsoDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number]
  return dayFormat('UTC').format(new Date(Date.UTC(y, m - 1, d, 12)))
}

export interface ShiftLabel {
  /** "Tue, Sep 15" - the local date the shift starts. */
  day: string
  /** "4:00 PM – 10:30 PM" */
  time: string
  /** True when the shift ends on a later local date than it starts. */
  endsNextDay: boolean
}

/** How a shift reads to a person at the location. */
export function formatShift(startsAt: Date, endsAt: Date, timeZone: string): ShiftLabel {
  const endsNextDay = localDateOf(startsAt, timeZone) !== localDateOf(endsAt, timeZone)
  return {
    day: dayFormat(timeZone).format(startsAt),
    time: `${timeFormat(timeZone).format(startsAt)} – ${timeFormat(timeZone).format(endsAt)}`,
    endsNextDay,
  }
}

/** "7h 30m" */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}
