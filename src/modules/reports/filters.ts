import { addCalendarDays } from '@/lib/dates'
import { isUuid } from '@/lib/uuid'

/*
 * REPORT FILTERS.
 *
 * Pure, and shared by the report pages and their CSV exports, so a download is
 * always exactly the rows on the screen. Anything malformed falls back to a
 * default rather than erroring: a bad link should still open a useful report.
 * Whether the viewer may use a given location is decided by the report, not
 * here.
 */

export const REPORT_KEYS = [
  'people',
  'training',
  'schedule',
  'operations',
  'communications',
] as const
export type ReportKey = (typeof REPORT_KEYS)[number]

export function isReportKey(value: string): value is ReportKey {
  return (REPORT_KEYS as readonly string[]).includes(value)
}

export interface ReportFilters {
  locationId: string | null
  departmentId: string | null
  jobRoleId: string | null
  /** Inclusive local calendar dates. */
  from: string
  to: string
}

export const DEFAULT_RANGE_DAYS = 30
export const MAX_RANGE_DAYS = 366

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function validDate(value: string | undefined): string | null {
  if (!value || !ISO_DATE.test(value)) return null
  const d = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? null : value
}

const uuidOrNull = (value: string | undefined) => (value && isUuid(value) ? value : null)

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

export function parseReportFilters(
  params: Partial<Record<'location' | 'department' | 'role' | 'from' | 'to', string | undefined>>,
  today: string,
): ReportFilters {
  let to = validDate(params.to) ?? today
  let from = validDate(params.from) ?? addCalendarDays(to, -(DEFAULT_RANGE_DAYS - 1))
  if (from > to) [from, to] = [to, from]
  if (daysBetween(from, to) >= MAX_RANGE_DAYS) from = addCalendarDays(to, -(MAX_RANGE_DAYS - 1))
  return {
    locationId: uuidOrNull(params.location),
    departmentId: uuidOrNull(params.department),
    jobRoleId: uuidOrNull(params.role),
    from,
    to,
  }
}

/** The same filters as a query string, for links and the export URL. */
export function filtersToQuery(filters: ReportFilters): string {
  const params = new URLSearchParams()
  if (filters.locationId) params.set('location', filters.locationId)
  if (filters.departmentId) params.set('department', filters.departmentId)
  if (filters.jobRoleId) params.set('role', filters.jobRoleId)
  params.set('from', filters.from)
  params.set('to', filters.to)
  return params.toString()
}

/** Is an instant's local date inside the range? */
export function inRange(localDate: string, filters: Pick<ReportFilters, 'from' | 'to'>): boolean {
  return localDate >= filters.from && localDate <= filters.to
}
