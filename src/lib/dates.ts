/**
 * BUSINESS DATES.
 *
 * The single most common source of scheduling bugs is treating "what day is
 * it" as a property of the server. It is a property of the LOCATION.
 *
 * Two rules this module encodes:
 *
 *  1. A business date is computed in the location's IANA timezone, never the
 *     server's and never UTC.
 *  2. A business day may not start at midnight. A restaurant closing at 2am
 *     is still working Tuesday. `dayCutoffHour` shifts the boundary, so a
 *     shift ending 01:30 Wednesday belongs to Tuesday's business date.
 *
 * Written in Slice 1, before any scheduling code exists, so the scheduling
 * slice inherits tested date handling rather than discovering it in
 * production on the second Sunday in March.
 */

export interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

const FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = FORMATTER_CACHE.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    FORMATTER_CACHE.set(timeZone, formatter)
  }
  return formatter
}

/** Wall-clock parts of an instant, as seen at `timeZone`. */
export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(instant)
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((p) => p.type === type)?.value
    if (value === undefined) throw new Error(`Missing ${type} for timezone ${timeZone}`)
    return Number(value)
  }
  // Intl renders midnight as hour 24 in some locales/engines.
  const hour = read('hour') % 24
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour,
    minute: read('minute'),
  }
}

function toIsoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Shift a calendar date by whole days. Pure calendar arithmetic, DST-free. */
export function addCalendarDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  if (y === undefined || m === undefined || d === undefined) {
    throw new Error(`Invalid ISO date: ${isoDate}`)
  }
  const shifted = new Date(Date.UTC(y, m - 1, d + days))
  return toIsoDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate())
}

/**
 * The business date an instant belongs to at a location.
 *
 * @param dayCutoffHour Local hour a business day begins. 0 = midnight.
 *                      4 means 01:30 belongs to the previous business date.
 */
export function businessDate(instant: Date, timeZone: string, dayCutoffHour = 0): string {
  if (dayCutoffHour < 0 || dayCutoffHour > 23) {
    throw new Error('dayCutoffHour must be between 0 and 23')
  }
  const parts = zonedParts(instant, timeZone)
  const isoDate = toIsoDate(parts.year, parts.month, parts.day)
  return parts.hour < dayCutoffHour ? addCalendarDays(isoDate, -1) : isoDate
}

/** UTC offset in minutes at an instant for a timezone. Negative west of UTC. */
export function utcOffsetMinutes(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute)
  // Compare at minute resolution; seconds are irrelevant for zone offsets.
  const instantMinutes = Math.floor(instant.getTime() / 60_000) * 60_000
  return Math.round((asUtc - instantMinutes) / 60_000)
}

/** True when a calendar date contains a UTC-offset change at this location. */
export function hasDstTransition(isoDate: string, timeZone: string): boolean {
  const [y, m, d] = isoDate.split('-').map(Number)
  if (y === undefined || m === undefined || d === undefined) return false
  // Sample well inside the day on both sides of a typical transition time.
  const early = new Date(Date.UTC(y, m - 1, d, 6, 0))
  const late = new Date(Date.UTC(y, m - 1, d, 22, 0))
  return utcOffsetMinutes(early, timeZone) !== utcOffsetMinutes(late, timeZone)
}
