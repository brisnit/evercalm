import { describe, expect, it } from 'vitest'
import {
  addCalendarDays,
  businessDate,
  hasDstTransition,
  utcOffsetMinutes,
  formatInZone,
  instantToZonedWallTime,
  zonedParts,
  zonedWallTimeToInstant,
} from '@/lib/dates'

const LA = 'America/Los_Angeles'
const DENVER = 'America/Denver'

describe('businessDate', () => {
  it('uses the location timezone, not the server timezone', () => {
    // 2026-03-02T04:30Z is still 2026-03-01 20:30 in Los Angeles.
    const instant = new Date('2026-03-02T04:30:00Z')
    expect(businessDate(instant, LA)).toBe('2026-03-01')
    expect(businessDate(instant, 'UTC')).toBe('2026-03-02')
  })

  it('gives two locations of one tenant different business dates at the same instant', () => {
    // Seeded salon spans Portland and Boise. At 2026-06-15T06:30Z it is
    // 23:30 on the 14th in Portland but 00:30 on the 15th in Boise.
    const instant = new Date('2026-06-15T06:30:00Z')
    expect(businessDate(instant, LA)).toBe('2026-06-14')
    expect(businessDate(instant, DENVER)).toBe('2026-06-15')
  })

  it('keeps a late close on the previous business date when a cutoff is set', () => {
    // 01:30 local Wednesday, closing out Tuesday's service.
    const instant = new Date('2026-07-15T08:30:00Z') // 01:30 PDT Wednesday
    expect(zonedParts(instant, LA).hour).toBe(1)
    expect(businessDate(instant, LA, 4)).toBe('2026-07-14')
    expect(businessDate(instant, LA, 0)).toBe('2026-07-15')
  })

  it('treats the cutoff hour itself as the start of the new business date', () => {
    const at0359 = new Date('2026-07-15T10:59:00Z') // 03:59 PDT
    const at0400 = new Date('2026-07-15T11:00:00Z') // 04:00 PDT
    expect(businessDate(at0359, LA, 4)).toBe('2026-07-14')
    expect(businessDate(at0400, LA, 4)).toBe('2026-07-15')
  })

  it('rejects an impossible cutoff hour', () => {
    expect(() => businessDate(new Date(), LA, 24)).toThrow()
    expect(() => businessDate(new Date(), LA, -1)).toThrow()
  })
})

describe('DST boundaries', () => {
  // US DST 2026: forward Sunday 8 March, back Sunday 1 November.
  it('detects the spring-forward and fall-back days', () => {
    expect(hasDstTransition('2026-03-08', LA)).toBe(true)
    expect(hasDstTransition('2026-11-01', LA)).toBe(true)
    expect(hasDstTransition('2026-06-15', LA)).toBe(false)
  })

  it('reports the offset change across spring forward', () => {
    expect(utcOffsetMinutes(new Date('2026-03-08T09:00:00Z'), LA)).toBe(-480) // PST
    expect(utcOffsetMinutes(new Date('2026-03-08T11:00:00Z'), LA)).toBe(-420) // PDT
  })

  it('assigns the correct business date through spring forward', () => {
    // 02:00-02:59 local does not exist on this date. Either side must still
    // resolve to 2026-03-08.
    expect(businessDate(new Date('2026-03-08T09:59:00Z'), LA)).toBe('2026-03-08') // 01:59 PST
    expect(businessDate(new Date('2026-03-08T10:00:00Z'), LA)).toBe('2026-03-08') // 03:00 PDT
  })

  it('assigns the correct business date through fall back, when 01:30 happens twice', () => {
    const firstPass = new Date('2026-11-01T08:30:00Z') // 01:30 PDT
    const secondPass = new Date('2026-11-01T09:30:00Z') // 01:30 PST
    expect(zonedParts(firstPass, LA).hour).toBe(1)
    expect(zonedParts(secondPass, LA).hour).toBe(1)
    expect(businessDate(firstPass, LA)).toBe('2026-11-01')
    expect(businessDate(secondPass, LA)).toBe('2026-11-01')
    // With a 4am cutoff both ambiguous instants belong to 31 October.
    expect(businessDate(firstPass, LA, 4)).toBe('2026-10-31')
    expect(businessDate(secondPass, LA, 4)).toBe('2026-10-31')
  })

  it('does not drift a calendar day across a DST boundary', () => {
    expect(addCalendarDays('2026-03-07', 1)).toBe('2026-03-08')
    expect(addCalendarDays('2026-03-08', 1)).toBe('2026-03-09')
    expect(addCalendarDays('2026-11-01', -1)).toBe('2026-10-31')
    expect(addCalendarDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addCalendarDays('2028-02-28', 1)).toBe('2028-02-29') // leap year
  })
})

describe('wall-clock times entered in an organization timezone', () => {
  // A manager in Los Angeles typing "9:30" means 9:30 in Los Angeles, whatever
  // timezone the server happens to run in.
  it('converts a winter time using the standard offset', () => {
    expect(zonedWallTimeToInstant('2026-01-15T09:30', LA)?.toISOString()).toBe(
      '2026-01-15T17:30:00.000Z',
    )
  })

  it('converts a summer time using the daylight offset', () => {
    expect(zonedWallTimeToInstant('2026-07-01T09:30', LA)?.toISOString()).toBe(
      '2026-07-01T16:30:00.000Z',
    )
  })

  it('round-trips back to the same wall-clock value', () => {
    for (const value of ['2026-01-15T09:30', '2026-07-01T23:45', '2026-11-01T12:00']) {
      const instant = zonedWallTimeToInstant(value, DENVER)
      expect(instant).not.toBeNull()
      expect(instantToZonedWallTime(instant!, DENVER)).toBe(value)
    }
  })

  it('rejects something that is not a date and time', () => {
    expect(zonedWallTimeToInstant('', LA)).toBeNull()
    expect(zonedWallTimeToInstant('tomorrow', LA)).toBeNull()
  })

  it('formats with the zone abbreviation, so nobody guesses', () => {
    expect(formatInZone(new Date('2026-07-01T16:30:00Z'), LA)).toMatch(/9:30.*PDT/)
  })
})
