import { describe, expect, it } from 'vitest'
import {
  formatDuration,
  formatShift,
  isIsoDate,
  isoWeekday,
  localTimeToInstant,
  overlaps,
  paidMinutes,
  parseTimeOfDay,
  shiftInstants,
  weekDates,
  weekStartOf,
} from '@/modules/scheduling/time'

/**
 * Scheduling time, without a database.
 *
 * The cases that break schedules in production: a shift past midnight, the
 * two nights a year the clocks change, a site in a different timezone, and a
 * clock time that does not exist.
 */

const LA = 'America/Los_Angeles'
const DENVER = 'America/Denver'

const t = (hhmm: string) => parseTimeOfDay(hhmm)!

describe('dates and weeks', () => {
  it('rejects dates that are not on the calendar', () => {
    expect(isIsoDate('2026-09-15')).toBe(true)
    expect(isIsoDate('2026-02-30')).toBe(false)
    expect(isIsoDate('15/09/2026')).toBe(false)
  })

  it('starts every week on Monday', () => {
    expect(isoWeekday('2026-09-14')).toBe(1)
    expect(isoWeekday('2026-09-20')).toBe(7)
    expect(weekStartOf('2026-09-16')).toBe('2026-09-14')
    expect(weekStartOf('2026-09-20')).toBe('2026-09-14')
    expect(weekStartOf('2026-09-14')).toBe('2026-09-14')
    expect(weekDates('2026-12-28')).toEqual([
      '2026-12-28',
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
      '2027-01-03',
    ])
  })

  it('parses clock times strictly', () => {
    expect(parseTimeOfDay('07:05')).toBe(425)
    expect(parseTimeOfDay('23:59')).toBe(1439)
    expect(parseTimeOfDay('24:00')).toBeNull()
    expect(parseTimeOfDay('7pm')).toBeNull()
  })
})

describe('shift instants', () => {
  it('reads clock times at the location, not the server', () => {
    const result = shiftInstants('2026-09-15', t('16:00'), t('22:30'), LA)
    expect(result).toMatchObject({ ok: true, overnight: false })
    if (!result.ok) throw new Error('expected ok')
    expect(result.startsAt.toISOString()).toBe('2026-09-15T23:00:00.000Z')
    expect(result.endsAt.toISOString()).toBe('2026-09-16T05:30:00.000Z')
  })

  it('reads the same clock times differently at a site in another timezone', () => {
    const result = shiftInstants('2026-09-15', t('09:00'), t('17:00'), DENVER)
    if (!result.ok) throw new Error('expected ok')
    expect(result.startsAt.toISOString()).toBe('2026-09-15T15:00:00.000Z')
  })

  it('runs an end time before the start into the next day', () => {
    const result = shiftInstants('2026-09-15', t('17:00'), t('01:00'), LA)
    if (!result.ok) throw new Error('expected ok')
    expect(result.overnight).toBe(true)
    expect(result.endsAt.toISOString()).toBe('2026-09-16T08:00:00.000Z')
    expect(paidMinutes(result.startsAt, result.endsAt, 30)).toBe(7 * 60 + 30)
  })

  it('counts the real hours on the night clocks spring forward', () => {
    // 2026-03-08: 02:00 does not happen in Los Angeles.
    const result = shiftInstants('2026-03-08', t('00:00'), t('08:00'), LA)
    if (!result.ok) throw new Error('expected ok')
    expect(paidMinutes(result.startsAt, result.endsAt, 0)).toBe(7 * 60)
  })

  it('counts the real hours on the night clocks fall back', () => {
    // 2026-11-01: 01:00-02:00 happens twice.
    const result = shiftInstants('2026-11-01', t('00:00'), t('08:00'), LA)
    if (!result.ok) throw new Error('expected ok')
    expect(paidMinutes(result.startsAt, result.endsAt, 0)).toBe(9 * 60)
  })

  it('refuses a clock time that does not exist, rather than moving it', () => {
    expect(shiftInstants('2026-03-08', t('02:30'), t('09:00'), LA)).toEqual({
      ok: false,
      reason: 'nonexistent_start',
    })
    expect(localTimeToInstant('2026-03-08', t('02:30'), LA)).toBeNull()
  })

  it('refuses a zero-length shift and nonsense input', () => {
    expect(shiftInstants('2026-09-15', t('09:00'), t('09:00'), LA)).toEqual({
      ok: false,
      reason: 'same_time',
    })
    expect(shiftInstants('2026-02-30', t('09:00'), t('17:00'), LA)).toEqual({
      ok: false,
      reason: 'invalid',
    })
  })

  it('treats midnight at the end of a date as the next date', () => {
    expect(localTimeToInstant('2026-09-15', 1440, LA)?.toISOString()).toBe(
      localTimeToInstant('2026-09-16', 0, LA)?.toISOString(),
    )
  })
})

describe('intervals and labels', () => {
  it('does not count back-to-back shifts as overlapping', () => {
    const a = new Date('2026-09-15T16:00:00Z')
    const b = new Date('2026-09-15T20:00:00Z')
    const c = new Date('2026-09-16T00:00:00Z')
    expect(overlaps(a, b, b, c)).toBe(false)
    expect(overlaps(a, c, b, c)).toBe(true)
  })

  it('labels a shift in the location’s time and flags a next-day end', () => {
    const result = shiftInstants('2026-09-15', t('17:00'), t('01:00'), LA)
    if (!result.ok) throw new Error('expected ok')
    const label = formatShift(result.startsAt, result.endsAt, LA)
    expect(label.day).toBe('Tue, Sep 15')
    expect(label.time).toBe('5:00 PM – 1:00 AM')
    expect(label.endsNextDay).toBe(true)
    expect(formatDuration(450)).toBe('7h 30m')
    expect(formatDuration(480)).toBe('8h')
  })
})
