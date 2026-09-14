import { describe, expect, it } from 'vitest'
import {
  detectConflicts,
  hasBlockingConflict,
  toSecondPerson,
  type PersonForConflicts,
  type ShiftForConflicts,
} from '@/modules/scheduling/conflicts'
import { parseTimeOfDay, shiftInstants } from '@/modules/scheduling/time'

/**
 * Conflict rules, exhaustively, without a database.
 *
 * Every assignment, publication, claim and swap approval asks this one
 * function, so each rule is pinned down here once.
 */

const LA = 'America/Los_Angeles'
const RIVERSIDE = 'loc-riverside'
const ROLE = 'role-server'

function shift(
  date: string,
  start: string,
  end: string,
  overrides: Partial<ShiftForConflicts> = {},
) {
  const times = shiftInstants(date, parseTimeOfDay(start)!, parseTimeOfDay(end)!, LA)
  if (!times.ok) throw new Error(`bad test shift ${date} ${start}-${end}`)
  return {
    id: 'this-shift',
    startsAt: times.startsAt,
    endsAt: times.endsAt,
    breakMinutes: 0,
    locationId: RIVERSIDE,
    jobRoleId: ROLE,
    timeZone: LA,
    ...overrides,
  } satisfies ShiftForConflicts
}

function other(id: string, date: string, start: string, end: string, breakMinutes = 0) {
  const s = shift(date, start, end)
  return { id, startsAt: s.startsAt, endsAt: s.endsAt, breakMinutes }
}

function person(overrides: Partial<PersonForConflicts> = {}): PersonForConflicts {
  return {
    employmentId: 'sam',
    displayName: 'Sam',
    status: 'active',
    locationIds: [RIVERSIDE],
    jobRoleIds: [ROLE],
    shifts: [],
    timeOff: [],
    availabilityRules: [],
    availabilityExceptions: [],
    ...overrides,
  }
}

const kinds = (s: ShiftForConflicts, p: PersonForConflicts) =>
  detectConflicts(s, p).map((c) => `${c.severity}:${c.kind}`)

// 2026-09-15 is a Tuesday.
const TUESDAY = '2026-09-15'

describe('no conflict', () => {
  it('passes a qualified, available person with nothing else on', () => {
    expect(detectConflicts(shift(TUESDAY, '16:00', '22:00'), person())).toEqual([])
  })
})

describe('blocking conflicts', () => {
  it('blocks an overlapping assignment, at any location', () => {
    const p = person({ shifts: [other('lunch', TUESDAY, '11:00', '17:00')] })
    expect(kinds(shift(TUESDAY, '16:00', '22:00'), p)).toContain('block:overlap')
  })

  it('does not treat the shift being edited as overlapping itself', () => {
    const s = shift(TUESDAY, '16:00', '22:00')
    const p = person({
      shifts: [{ id: 'this-shift', startsAt: s.startsAt, endsAt: s.endsAt, breakMinutes: 0 }],
    })
    expect(detectConflicts(s, p)).toEqual([])
  })

  it('blocks approved time off, and catches it on the second day of an overnight shift', () => {
    const p = person({
      timeOff: [
        {
          id: 'to',
          startsOn: '2026-09-16',
          endsOn: '2026-09-16',
          startMinute: null,
          endMinute: null,
          status: 'approved',
        },
      ],
    })
    expect(kinds(shift(TUESDAY, '20:00', '02:00'), p)).toContain('block:time_off_approved')
    expect(kinds(shift(TUESDAY, '09:00', '17:00'), p)).not.toContain('block:time_off_approved')
  })

  it('reads a partial-day time-off window in the location’s clock time', () => {
    const p = person({
      timeOff: [
        {
          id: 'to',
          startsOn: TUESDAY,
          endsOn: TUESDAY,
          startMinute: 12 * 60,
          endMinute: 15 * 60,
          status: 'approved',
        },
      ],
    })
    expect(kinds(shift(TUESDAY, '09:00', '12:30'), p)).toContain('block:time_off_approved')
    expect(kinds(shift(TUESDAY, '15:00', '22:00'), p)).not.toContain('block:time_off_approved')
  })

  it('blocks someone not assigned to the location, and someone inactive', () => {
    expect(
      kinds(shift(TUESDAY, '16:00', '22:00'), person({ locationIds: ['elsewhere'] })),
    ).toContain('block:not_at_location')
    expect(kinds(shift(TUESDAY, '16:00', '22:00'), person({ status: 'suspended' }))).toContain(
      'block:inactive',
    )
  })
})

describe('warnings', () => {
  it('warns on pending time off, and ignores denied or cancelled requests', () => {
    const request = (status: string) =>
      person({
        timeOff: [
          {
            id: 'to',
            startsOn: TUESDAY,
            endsOn: TUESDAY,
            startMinute: null,
            endMinute: null,
            status,
          },
        ],
      })
    expect(kinds(shift(TUESDAY, '16:00', '22:00'), request('pending'))).toEqual([
      'warn:time_off_pending',
    ])
    expect(kinds(shift(TUESDAY, '16:00', '22:00'), request('denied'))).toEqual([])
    expect(kinds(shift(TUESDAY, '16:00', '22:00'), request('cancelled'))).toEqual([])
  })

  it('warns when the weekly pattern says unavailable', () => {
    const p = person({
      availabilityRules: [
        { weekday: 2, startMinute: 18 * 60, endMinute: 24 * 60, preference: 'unavailable' },
      ],
    })
    expect(kinds(shift(TUESDAY, '16:00', '22:00'), p)).toEqual(['warn:unavailable'])
    expect(kinds(shift(TUESDAY, '09:00', '17:00'), p)).toEqual([])
    // Wednesday is not covered by a Tuesday rule.
    expect(kinds(shift('2026-09-16', '19:00', '22:00'), p)).toEqual([])
  })

  it('lets a dated exception replace the weekly pattern for that date', () => {
    const rule = { weekday: 2, startMinute: 0, endMinute: 24 * 60, preference: 'unavailable' }
    const freeThisTuesday = person({
      availabilityRules: [rule],
      availabilityExceptions: [
        { onDate: TUESDAY, startMinute: null, endMinute: null, preference: 'available' },
      ],
    })
    expect(kinds(shift(TUESDAY, '16:00', '22:00'), freeThisTuesday)).toEqual([])

    const busyAfternoon = person({
      availabilityExceptions: [
        { onDate: TUESDAY, startMinute: 13 * 60, endMinute: 17 * 60, preference: 'unavailable' },
      ],
    })
    expect(kinds(shift(TUESDAY, '16:00', '22:00'), busyAfternoon)).toEqual(['warn:unavailable'])
  })

  it('warns when the person lacks the shift’s job role, and not when the shift has none', () => {
    expect(kinds(shift(TUESDAY, '16:00', '22:00'), person({ jobRoleIds: [] }))).toEqual([
      'warn:missing_job_role',
    ])
    expect(
      kinds(shift(TUESDAY, '16:00', '22:00', { jobRoleId: null }), person({ jobRoleIds: [] })),
    ).toEqual([])
  })

  it('warns on a short turnaround, but not on a full rest', () => {
    const closing = other('close', TUESDAY, '17:00', '01:00') // ends 1am Wednesday
    expect(kinds(shift('2026-09-16', '08:00', '14:00'), person({ shifts: [closing] }))).toEqual([
      'warn:short_rest',
    ])
    expect(kinds(shift('2026-09-16', '09:00', '14:00'), person({ shifts: [closing] }))).toEqual([])
  })

  it('warns when the week goes over the threshold, counting only that local week', () => {
    const week = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18'].map(
      (d, i) => other(`s${i}`, d, '09:00', '17:00'),
    )
    // Five 8-hour days = 40 hours. A sixth pushes it over.
    const saturday = shift('2026-09-19', '09:00', '13:00')
    expect(kinds(saturday, person({ shifts: week }))).toEqual(['warn:long_week'])
    // The following Monday starts a new week.
    expect(kinds(shift('2026-09-21', '09:00', '13:00'), person({ shifts: week }))).toEqual([])
  })
})

describe('severity', () => {
  it('reports whether anything blocks', () => {
    const blocked = detectConflicts(shift(TUESDAY, '16:00', '22:00'), person({ locationIds: [] }))
    expect(hasBlockingConflict(blocked)).toBe(true)
    expect(
      hasBlockingConflict(
        detectConflicts(shift(TUESDAY, '16:00', '22:00'), person({ jobRoleIds: [] })),
      ),
    ).toBe(false)
  })
})

describe('messages to the person themselves', () => {
  it('reads naturally in the second person', () => {
    expect(toSecondPerson('Sam is already on a shift that overlaps this one.', 'Sam')).toBe(
      'You are already on a shift that overlaps this one.',
    )
    expect(toSecondPerson('Sam has approved time off during this shift.', 'Sam')).toBe(
      'You have approved time off during this shift.',
    )
    expect(toSecondPerson('Sam does not hold the job role this shift is for.', 'Sam')).toBe(
      'You do not hold the job role this shift is for.',
    )
    expect(
      toSecondPerson('Sam said they are unavailable for some or all of this shift.', 'Sam'),
    ).toBe('You said you are unavailable for some or all of this shift.')
    expect(toSecondPerson('Someone else is busy.', 'Sam')).toBe('Someone else is busy.')
  })
})
