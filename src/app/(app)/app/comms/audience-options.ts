import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import type { Tx } from '@/server/db/types'
import type { Actor } from '@/server/authz/actor'
import { departments, employments, jobRoles, locations, stations, teams } from '@/server/db/schema'
import { publishingScope } from '@/modules/comms/audience'
import type { AudienceSelectorType } from '@/modules/comms/audience-types'

/**
 * What an author is allowed to pick from.
 *
 * The list is narrowed to the author's own reach BEFORE it reaches the
 * browser, so a location manager is never shown another location's teams and
 * people. That is a courtesy, not the control: `assertRulesWithinScope` refuses
 * the same things server-side whatever the form posts.
 *
 * Departments and job roles are offered to a location-scoped author only in
 * combination with a location - on their own they would span the organization,
 * which is why the resolver refuses them as a standalone include.
 */

export interface AudienceOption {
  type: AudienceSelectorType
  id: string | null
  label: string
  /** Shown under the label: where this group is, or what it contains. */
  hint?: string
}

export interface AudienceOptionGroups {
  organization: AudienceOption[]
  locations: AudienceOption[]
  departments: AudienceOption[]
  jobRoles: AudienceOption[]
  teams: AudienceOption[]
  stations: AudienceOption[]
  people: AudienceOption[]
}

export async function audienceOptions(tx: Tx, actor: Actor): Promise<AudienceOptionGroups> {
  const scope = publishingScope(actor)
  const orgId = actor.organizationId
  const limitTo = scope.organizationWide ? null : scope.locationIds

  const locationRows = await tx
    .select({ id: locations.id, name: locations.name, city: locations.city })
    .from(locations)
    .where(
      and(
        eq(locations.organizationId, orgId),
        isNull(locations.archivedAt),
        limitTo ? inArray(locations.id, limitTo.length > 0 ? limitTo : ['']) : undefined,
      ),
    )
    .orderBy(asc(locations.name))

  const departmentRows = await tx
    .select({ id: departments.id, name: departments.name })
    .from(departments)
    .where(and(eq(departments.organizationId, orgId), isNull(departments.archivedAt)))
    .orderBy(asc(departments.position))

  const jobRoleRows = await tx
    .select({ id: jobRoles.id, name: jobRoles.name })
    .from(jobRoles)
    .where(and(eq(jobRoles.organizationId, orgId), isNull(jobRoles.archivedAt)))
    .orderBy(asc(jobRoles.position))

  const teamRows = await tx
    .select({
      id: teams.id,
      name: teams.name,
      locationId: teams.locationId,
      locationName: locations.name,
    })
    .from(teams)
    .leftJoin(
      locations,
      and(eq(locations.organizationId, teams.organizationId), eq(locations.id, teams.locationId)),
    )
    .where(and(eq(teams.organizationId, orgId), isNull(teams.archivedAt)))
    .orderBy(asc(teams.name))

  const stationRows = await tx
    .select({
      id: stations.id,
      name: stations.name,
      locationId: stations.locationId,
      locationName: locations.name,
    })
    .from(stations)
    .innerJoin(
      locations,
      and(
        eq(locations.organizationId, stations.organizationId),
        eq(locations.id, stations.locationId),
      ),
    )
    .where(and(eq(stations.organizationId, orgId), isNull(stations.archivedAt)))
    .orderBy(asc(stations.name))

  const peopleRows = await tx
    .select({
      id: employments.id,
      name: employments.displayName,
      jobTitle: employments.jobTitle,
      homeLocationId: employments.homeLocationId,
    })
    .from(employments)
    .where(and(eq(employments.organizationId, orgId), isNull(employments.archivedAt)))
    .orderBy(asc(employments.displayName))

  const withinScope = (locationId: string | null): boolean =>
    limitTo === null || (locationId !== null && limitTo.includes(locationId))

  return {
    organization: scope.organizationWide
      ? [{ type: 'organization', id: null, label: 'Everyone in the organization' }]
      : [],
    locations: locationRows.map((l) => ({
      type: 'location' as const,
      id: l.id,
      label: l.name,
      hint: l.city ?? undefined,
    })),
    // Only offered org-wide; a location author narrows with a location instead.
    departments: scope.organizationWide
      ? departmentRows.map((d) => ({
          type: 'department' as const,
          id: d.id,
          label: `${d.name} department`,
        }))
      : [],
    jobRoles: scope.organizationWide
      ? jobRoleRows.map((r) => ({ type: 'job_role' as const, id: r.id, label: r.name }))
      : [],
    teams: teamRows
      .filter((t) => withinScope(t.locationId))
      .map((t) => ({
        type: 'team' as const,
        id: t.id,
        label: `${t.name} team`,
        hint: t.locationName ?? 'Organization-wide',
      })),
    stations: stationRows
      .filter((s) => withinScope(s.locationId))
      .map((s) => ({
        type: 'station' as const,
        id: s.id,
        label: `${s.name} station`,
        hint: s.locationName,
      })),
    people: peopleRows
      .filter((p) => withinScope(p.homeLocationId))
      .map((p) => ({
        type: 'employment' as const,
        id: p.id,
        label: p.name,
        hint: p.jobTitle ?? undefined,
      })),
  }
}
