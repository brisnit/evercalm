import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import type { Tx } from '@/server/db'
import {
  departments,
  employmentJobRoles,
  employmentLocations,
  employments,
  jobRoles,
  locations,
} from '@/server/db/schema'
import type { Actor, Capability } from '@/server/authz'
import { accessibleLocationIds, canAtAnyLocation } from '@/server/authz/can'
import { ForbiddenError, NotFoundError } from '@/lib/errors'
import type { ReportFilters, ReportKey } from './filters'

/*
 * WHO SEES WHICH REPORT, FOR WHICH PEOPLE.
 *
 * Each report has one capability, location-scopable. Held organization-wide,
 * the report covers every location; held at locations, it covers exactly
 * those, and choosing any other location is not found. Department and job
 * role then narrow the people further.
 *
 * Holding no reporting capability at all is not found; holding a different
 * one is forbidden, so a training manager is told they lack schedule
 * reporting rather than that it does not exist.
 */

export const REPORT_CAPABILITY: Record<ReportKey, Capability> = {
  people: 'report.people',
  training: 'report.training',
  schedule: 'report.operations',
  operations: 'report.operations',
  communications: 'report.communications',
}

const ALL_REPORT_CAPABILITIES: readonly Capability[] = [
  'report.people',
  'report.training',
  'report.operations',
  'report.communications',
]

export function canUseReports(actor: Actor): boolean {
  return ALL_REPORT_CAPABILITIES.some((c) => canAtAnyLocation(actor, c))
}

export function canSeeReport(actor: Actor, key: ReportKey): boolean {
  return canAtAnyLocation(actor, REPORT_CAPABILITY[key])
}

export interface LocationOption {
  id: string
  name: string
  timeZone: string
}

export interface ReportScope {
  /** Every location the actor may report on, for the filter. */
  available: LocationOption[]
  /** The locations this report covers after the location filter. */
  locations: LocationOption[]
  locationIds: string[]
  /** True when the actor's view is limited to some locations. */
  partial: boolean
  departments: { id: string; name: string }[]
  jobRoles: { id: string; name: string; departmentId: string | null }[]
}

export async function resolveScope(
  tx: Tx,
  actor: Actor,
  key: ReportKey,
  filters: ReportFilters,
  restrictTo: readonly string[] | null = null,
): Promise<ReportScope> {
  const capability = REPORT_CAPABILITY[key]
  if (!canAtAnyLocation(actor, capability)) {
    if (canUseReports(actor)) throw new ForbiddenError(capability)
    throw new NotFoundError('Report not found')
  }
  let allowed = accessibleLocationIds(actor, capability)
  if (restrictTo !== null)
    allowed = allowed === null ? [...restrictTo] : allowed.filter((id) => restrictTo.includes(id))

  const rows = await tx
    .select({ id: locations.id, name: locations.name, timeZone: locations.timezone })
    .from(locations)
    .where(
      and(
        eq(locations.organizationId, actor.organizationId),
        isNull(locations.archivedAt),
        allowed === null
          ? undefined
          : inArray(
              locations.id,
              allowed.length ? allowed : ['00000000-0000-0000-0000-000000000000'],
            ),
      ),
    )
    .orderBy(asc(locations.name))

  if (filters.locationId && !rows.some((r) => r.id === filters.locationId)) {
    throw new NotFoundError('Location not found')
  }
  const chosen = filters.locationId ? rows.filter((r) => r.id === filters.locationId) : rows

  const [deptRows, roleRows] = await Promise.all([
    tx
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .where(eq(departments.organizationId, actor.organizationId))
      .orderBy(asc(departments.name)),
    tx
      .select({ id: jobRoles.id, name: jobRoles.name, departmentId: jobRoles.departmentId })
      .from(jobRoles)
      .where(and(eq(jobRoles.organizationId, actor.organizationId), isNull(jobRoles.archivedAt)))
      .orderBy(asc(jobRoles.name)),
  ])
  if (filters.departmentId && !deptRows.some((d) => d.id === filters.departmentId))
    throw new NotFoundError('Department not found')
  if (filters.jobRoleId && !roleRows.some((r) => r.id === filters.jobRoleId))
    throw new NotFoundError('Job role not found')

  return {
    available: rows,
    locations: chosen,
    locationIds: chosen.map((c) => c.id),
    partial: allowed !== null || restrictTo !== null,
    departments: deptRows,
    jobRoles: roleRows,
  }
}

export interface PersonRef {
  id: string
  name: string
  status: string
  locationNames: string[]
  roleIds: string[]
  roleNames: string[]
  departmentIds: string[]
}

/**
 * Everyone who works at the covered locations and matches the department and
 * job role filters. Names and structure only.
 */
export async function peopleInScope(
  tx: Tx,
  organizationId: string,
  scope: ReportScope,
  filters: ReportFilters,
): Promise<Map<string, PersonRef>> {
  if (scope.locationIds.length === 0) return new Map()
  const placed = await tx
    .select({
      id: employments.id,
      name: employments.displayName,
      status: employments.status,
      locationId: employmentLocations.locationId,
    })
    .from(employmentLocations)
    .innerJoin(
      employments,
      and(
        eq(employments.organizationId, employmentLocations.organizationId),
        eq(employments.id, employmentLocations.employmentId),
      ),
    )
    .where(
      and(
        eq(employmentLocations.organizationId, organizationId),
        inArray(employmentLocations.locationId, scope.locationIds),
      ),
    )
  const locationName = new Map(scope.locations.map((l) => [l.id, l.name]))
  const people = new Map<string, PersonRef>()
  for (const row of placed) {
    const person = people.get(row.id) ?? {
      id: row.id,
      name: row.name,
      status: row.status,
      locationNames: [],
      roleIds: [],
      roleNames: [],
      departmentIds: [],
    }
    const name = locationName.get(row.locationId)
    if (name && !person.locationNames.includes(name)) person.locationNames.push(name)
    people.set(row.id, person)
  }
  if (people.size === 0) return people

  const roles = await tx
    .select({
      employmentId: employmentJobRoles.employmentId,
      roleId: jobRoles.id,
      roleName: jobRoles.name,
      departmentId: jobRoles.departmentId,
    })
    .from(employmentJobRoles)
    .innerJoin(
      jobRoles,
      and(
        eq(jobRoles.organizationId, employmentJobRoles.organizationId),
        eq(jobRoles.id, employmentJobRoles.jobRoleId),
      ),
    )
    .where(
      and(
        eq(employmentJobRoles.organizationId, organizationId),
        inArray(employmentJobRoles.employmentId, [...people.keys()]),
      ),
    )
  for (const role of roles) {
    const person = people.get(role.employmentId)
    if (!person) continue
    person.roleIds.push(role.roleId)
    person.roleNames.push(role.roleName)
    if (role.departmentId) person.departmentIds.push(role.departmentId)
  }

  for (const [id, person] of people) {
    if (filters.jobRoleId && !person.roleIds.includes(filters.jobRoleId)) people.delete(id)
    else if (filters.departmentId && !person.departmentIds.includes(filters.departmentId))
      people.delete(id)
  }
  return people
}

/** Job roles a department filter stands for, or null for no role filter. */
export function roleFilter(scope: ReportScope, filters: ReportFilters): string[] | null {
  if (filters.jobRoleId) return [filters.jobRoleId]
  if (filters.departmentId)
    return scope.jobRoles.filter((r) => r.departmentId === filters.departmentId).map((r) => r.id)
  return null
}
