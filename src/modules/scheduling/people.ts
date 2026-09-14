import { and, asc, eq, gt, gte, inArray, isNull, lt, lte, sql } from 'drizzle-orm'
import type { Tx } from '@/server/db'
import { employmentJobRoles, employmentLocations, employments } from '@/server/db/schema'
import { addCalendarDays } from '@/lib/dates'
import type { PersonForConflicts, ShiftForConflicts } from './conflicts'
import { availabilityExceptions, availabilityRules, shifts, timeOffRequests } from './schema'

/*
 * Everything conflict detection needs to know about people, loaded in a fixed
 * number of queries however many people are asked about.
 */

export interface SchedulablePerson {
  employmentId: string
  displayName: string
  status: string
  jobRoleIds: string[]
}

/** Active people assigned to work at a location, by name. */
export async function listSchedulablePeople(
  tx: Tx,
  organizationId: string,
  locationId: string,
): Promise<SchedulablePerson[]> {
  const rows = await tx
    .select({
      employmentId: employments.id,
      displayName: employments.displayName,
      status: employments.status,
    })
    .from(employments)
    .innerJoin(
      employmentLocations,
      and(
        eq(employmentLocations.organizationId, employments.organizationId),
        eq(employmentLocations.employmentId, employments.id),
      ),
    )
    .where(
      and(
        eq(employments.organizationId, organizationId),
        eq(employmentLocations.locationId, locationId),
        eq(employments.status, 'active'),
        isNull(employments.archivedAt),
      ),
    )
    .orderBy(asc(employments.displayName))

  const roles = await jobRolesFor(
    tx,
    organizationId,
    rows.map((r) => r.employmentId),
  )
  return rows.map((row) => ({ ...row, jobRoleIds: roles.get(row.employmentId) ?? [] }))
}

async function jobRolesFor(
  tx: Tx,
  organizationId: string,
  employmentIds: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  if (employmentIds.length === 0) return out
  const rows = await tx
    .select({
      employmentId: employmentJobRoles.employmentId,
      jobRoleId: employmentJobRoles.jobRoleId,
    })
    .from(employmentJobRoles)
    .where(
      and(
        eq(employmentJobRoles.organizationId, organizationId),
        inArray(employmentJobRoles.employmentId, employmentIds),
      ),
    )
  for (const row of rows)
    out.set(row.employmentId, [...(out.get(row.employmentId) ?? []), row.jobRoleId])
  return out
}

/**
 * Conflict context for a set of people around a period.
 *
 * The period is widened by eight days either side so rest-between-shifts and
 * weekly-hours checks see the neighbouring shifts, and by two days for dated
 * records so a timezone difference cannot drop an edge.
 */
export async function loadConflictPeople(
  tx: Tx,
  organizationId: string,
  employmentIds: readonly string[],
  period: { from: Date; to: Date },
): Promise<Map<string, PersonForConflicts>> {
  const ids = [...new Set(employmentIds)]
  const out = new Map<string, PersonForConflicts>()
  if (ids.length === 0) return out

  const from = new Date(period.from.getTime() - 8 * 86_400_000)
  const to = new Date(period.to.getTime() + 8 * 86_400_000)
  const fromDate = addCalendarDays(period.from.toISOString().slice(0, 10), -2)
  const toDate = addCalendarDays(period.to.toISOString().slice(0, 10), 2)

  const people = await tx
    .select({
      employmentId: employments.id,
      displayName: employments.displayName,
      status: employments.status,
    })
    .from(employments)
    .where(and(eq(employments.organizationId, organizationId), inArray(employments.id, ids)))

  const locationRows = await tx
    .select({
      employmentId: employmentLocations.employmentId,
      locationId: employmentLocations.locationId,
    })
    .from(employmentLocations)
    .where(
      and(
        eq(employmentLocations.organizationId, organizationId),
        inArray(employmentLocations.employmentId, ids),
      ),
    )

  const roles = await jobRolesFor(tx, organizationId, ids)

  const shiftRows = await tx
    .select({
      id: shifts.id,
      assignee: shifts.assigneeEmploymentId,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      breakMinutes: shifts.breakMinutes,
    })
    .from(shifts)
    .where(
      and(
        eq(shifts.organizationId, organizationId),
        eq(shifts.status, 'active'),
        inArray(shifts.assigneeEmploymentId, ids),
        lt(shifts.startsAt, to),
        gt(shifts.endsAt, from),
      ),
    )

  const timeOffRows = await tx
    .select({
      id: timeOffRequests.id,
      employmentId: timeOffRequests.employmentId,
      startsOn: timeOffRequests.startsOn,
      endsOn: timeOffRequests.endsOn,
      startMinute: timeOffRequests.startMinute,
      endMinute: timeOffRequests.endMinute,
      status: timeOffRequests.status,
    })
    .from(timeOffRequests)
    .where(
      and(
        eq(timeOffRequests.organizationId, organizationId),
        inArray(timeOffRequests.employmentId, ids),
        inArray(timeOffRequests.status, ['pending', 'approved']),
        lte(timeOffRequests.startsOn, toDate),
        gte(timeOffRequests.endsOn, fromDate),
      ),
    )

  const ruleRows = await tx
    .select({
      employmentId: availabilityRules.employmentId,
      weekday: availabilityRules.weekday,
      startMinute: availabilityRules.startMinute,
      endMinute: availabilityRules.endMinute,
      preference: availabilityRules.preference,
    })
    .from(availabilityRules)
    .where(
      and(
        eq(availabilityRules.organizationId, organizationId),
        inArray(availabilityRules.employmentId, ids),
      ),
    )

  const exceptionRows = await tx
    .select({
      employmentId: availabilityExceptions.employmentId,
      onDate: availabilityExceptions.onDate,
      startMinute: availabilityExceptions.startMinute,
      endMinute: availabilityExceptions.endMinute,
      preference: availabilityExceptions.preference,
    })
    .from(availabilityExceptions)
    .where(
      and(
        eq(availabilityExceptions.organizationId, organizationId),
        inArray(availabilityExceptions.employmentId, ids),
        sql`${availabilityExceptions.onDate} between ${fromDate} and ${toDate}`,
      ),
    )

  for (const person of people) {
    const id = person.employmentId
    out.set(id, {
      employmentId: id,
      displayName: person.displayName,
      status: person.status,
      locationIds: locationRows.filter((r) => r.employmentId === id).map((r) => r.locationId),
      jobRoleIds: roles.get(id) ?? [],
      shifts: shiftRows
        .filter((r) => r.assignee === id)
        .map((r) => ({
          id: r.id,
          startsAt: r.startsAt,
          endsAt: r.endsAt,
          breakMinutes: r.breakMinutes,
        })),
      timeOff: timeOffRows.filter((r) => r.employmentId === id),
      availabilityRules: ruleRows.filter((r) => r.employmentId === id),
      availabilityExceptions: exceptionRows.filter((r) => r.employmentId === id),
    })
  }
  return out
}

/**
 * A person's context with one or more shifts removed - "as if they no longer
 * held these". Used for trades, where each side gives one shift up.
 */
export function withoutShifts(
  person: PersonForConflicts,
  shiftIds: readonly string[],
): PersonForConflicts {
  return { ...person, shifts: person.shifts.filter((s) => !shiftIds.includes(s.id)) }
}

export function conflictShift(
  row: {
    id: string | null
    startsAt: Date
    endsAt: Date
    breakMinutes: number
    locationId: string
    jobRoleId: string | null
  },
  timeZone: string,
): ShiftForConflicts {
  return { ...row, timeZone }
}
