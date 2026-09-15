import { describe, expect, it } from 'vitest'
import { filtersToQuery, inRange, parseReportFilters } from '@/modules/reports/filters'

/** Report filters: forgiving of bad links, and the same for screen and export. */

const today = '2026-09-14'
const uuid = '11111111-2222-4333-8444-555555555555'

describe('report filters', () => {
  it('defaults to the last 30 days, ending today', () => {
    expect(parseReportFilters({}, today)).toEqual({
      locationId: null,
      departmentId: null,
      jobRoleId: null,
      from: '2026-08-16',
      to: today,
    })
  })

  it('drops malformed ids and dates instead of failing', () => {
    const f = parseReportFilters(
      { location: "1' or '1'='1", role: uuid, from: '2026-02-30', to: 'soon' },
      today,
    )
    expect(f.locationId).toBeNull()
    expect(f.jobRoleId).toBe(uuid)
    expect(f.to).toBe(today)
  })

  it('puts reversed dates the right way round and caps the range at a year', () => {
    expect(parseReportFilters({ from: '2026-09-10', to: '2026-09-01' }, today)).toMatchObject({
      from: '2026-09-01',
      to: '2026-09-10',
    })
    expect(parseReportFilters({ from: '2020-01-01', to: '2026-09-14' }, today).from).toBe(
      '2025-09-14',
    )
  })

  it('round-trips through a query string', () => {
    const f = parseReportFilters({ location: uuid, from: '2026-09-01', to: '2026-09-07' }, today)
    const again = parseReportFilters(
      Object.fromEntries(new URLSearchParams(filtersToQuery(f))),
      today,
    )
    expect(again).toEqual(f)
    expect(inRange('2026-09-07', f)).toBe(true)
    expect(inRange('2026-09-08', f)).toBe(false)
  })
})
