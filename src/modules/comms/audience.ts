import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import type { Tx } from '@/server/db/types'
import type { Actor } from '@/server/authz/actor'
import { accessibleLocationIds } from '@/server/authz/can'
import { ForbiddenError, ValidationError } from '@/lib/errors'
import {
  departments,
  employmentJobRoles,
  employmentLocations,
  employmentTeams,
  employments,
  jobRoles,
  locations,
  stations,
  teams,
} from '@/server/db/schema'
import type { AudienceMode, AudienceSelectorType } from './schema'

/**
 * AUDIENCE RESOLUTION.
 *
 * An audience is a list of explicit rules, not a stored query. Each rule names
 * one group; the set of rules is evaluated like this, and the authoring screen
 * says so in the same words:
 *
 *   includes are a UNION    anyone matching ANY include rule is in
 *   excludes are subtracted anyone matching ANY exclude rule is out
 *   exclude always wins     even against a more specific include
 *
 * A union, not an intersection, because that is what a manager means. "All
 * bartenders and all hosts" is two groups of people; read as an intersection
 * it would be the empty set of people who are somehow both. Narrowing is
 * expressed by excluding, which reads the way it behaves: "everyone at
 * Riverside, except the kitchen".
 *
 * SCOPE. Every rule is checked against the author's own permission before it
 * is stored AND again before it is resolved. A manager scoped to one location
 * cannot target another location, cannot target the organization, and cannot
 * name an individual who does not work at a location they cover. The check is
 * on the way in and on the way out, because a draft saved before somebody's
 * grants were narrowed must not still publish widely afterwards.
 */

export interface AudienceRuleInput {
  mode: AudienceMode
  selectorType: AudienceSelectorType
  selectorId: string | null
}

export interface ResolvedPerson {
  employmentId: string
  displayName: string
  /** Home location, used for the reporting snapshot. May be null. */
  locationId: string | null
  departmentId: string | null
  jobRoleId: string | null
}

/** What a selector points at, for the human-readable summary. */
export interface SelectorLabel {
  type: AudienceSelectorType
  id: string | null
  label: string
}

/**
 * The publishing reach an actor has.
 *
 * `null` locations means organization-wide: the actor may target everyone.
 * An empty array means they may publish nowhere, which is a refusal, not an
 * empty audience.
 */
export interface PublishingScope {
  organizationWide: boolean
  locationIds: string[]
}

export function publishingScope(actor: Actor): PublishingScope {
  const ids = accessibleLocationIds(actor, 'announcement.create')
  return ids === null
    ? { organizationWide: true, locationIds: [] }
    : { organizationWide: false, locationIds: ids }
}

/**
 * Refuse rules the actor may not use.
 *
 * Deliberately strict: a location-scoped manager may only name their own
 * locations, and may only name a department, role, team, station or person
 * that exists inside those locations. Anything else throws rather than being
 * silently narrowed - quietly sending to fewer people than the author asked
 * for is its own kind of failure.
 */
export async function assertRulesWithinScope(
  tx: Tx,
  actor: Actor,
  rules: readonly AudienceRuleInput[],
): Promise<void> {
  const scope = publishingScope(actor)
  if (scope.organizationWide) {
    // Still has to be this tenant's data; resolveSelectorLabels enforces that.
    await resolveSelectorLabels(tx, actor.organizationId, rules)
    return
  }

  if (scope.locationIds.length === 0) {
    throw new ForbiddenError('announcement.create')
  }

  for (const rule of rules) {
    // Excludes only ever remove people, so a narrower author may exclude
    // anything without widening their reach.
    if (rule.mode === 'exclude') continue

    if (rule.selectorType === 'organization') {
      throw new ForbiddenError(
        'announcement.publish (organization-wide targeting needs an organization-wide grant)',
      )
    }
    if (rule.selectorId === null) continue

    const allowed = await selectorIsWithinLocations(
      tx,
      actor.organizationId,
      rule.selectorType,
      rule.selectorId,
      scope.locationIds,
    )
    if (!allowed) {
      throw new ForbiddenError(
        `announcement.publish (${rule.selectorType} is outside your locations)`,
      )
    }
  }

  await resolveSelectorLabels(tx, actor.organizationId, rules)
}

async function selectorIsWithinLocations(
  tx: Tx,
  organizationId: string,
  type: AudienceSelectorType,
  id: string,
  allowedLocationIds: string[],
): Promise<boolean> {
  switch (type) {
    case 'organization':
      return false

    case 'location':
      return allowedLocationIds.includes(id)

    case 'team': {
      const [row] = await tx
        .select({ locationId: teams.locationId })
        .from(teams)
        .where(and(eq(teams.organizationId, organizationId), eq(teams.id, id)))
        .limit(1)
      if (!row) return false
      // A team with no location belongs to the whole organization.
      return row.locationId !== null && allowedLocationIds.includes(row.locationId)
    }

    case 'station': {
      const [row] = await tx
        .select({ locationId: stations.locationId })
        .from(stations)
        .where(and(eq(stations.organizationId, organizationId), eq(stations.id, id)))
        .limit(1)
      return row ? allowedLocationIds.includes(row.locationId) : false
    }

    case 'employment': {
      // The person must work at a location the author covers.
      const rows = await tx
        .select({ locationId: employmentLocations.locationId })
        .from(employmentLocations)
        .where(
          and(
            eq(employmentLocations.organizationId, organizationId),
            eq(employmentLocations.employmentId, id),
          ),
        )
      return rows.some((r) => allowedLocationIds.includes(r.locationId))
    }

    case 'department':
    case 'job_role':
      // A department or role spans the organization, so a location-scoped
      // author may not use it as an include on its own - it would reach people
      // at sites they do not cover. Combining it with a location is the
      // supported way to say "bartenders at Riverside", and the resolver
      // intersects role includes with the author's locations below.
      return false
  }
}

/**
 * Resolve rules to people.
 *
 * `restrictToLocationIds` is applied on top of the rules for a location-scoped
 * author, so even a rule that was legitimate when saved cannot reach outside
 * their current permission.
 */
export async function resolveAudience(
  tx: Tx,
  organizationId: string,
  rules: readonly AudienceRuleInput[],
  options: { restrictToLocationIds?: string[] | null } = {},
): Promise<ResolvedPerson[]> {
  const includes = rules.filter((r) => r.mode === 'include')
  const excludes = rules.filter((r) => r.mode === 'exclude')
  if (includes.length === 0) return []

  const included = new Set<string>()
  for (const rule of includes) {
    for (const id of await matchSelector(tx, organizationId, rule)) included.add(id)
  }

  for (const rule of excludes) {
    for (const id of await matchSelector(tx, organizationId, rule)) included.delete(id)
  }

  if (included.size === 0) return []

  const people = await describePeople(tx, organizationId, [...included])

  const restrict = options.restrictToLocationIds
  if (!restrict) return people

  const allowed = new Set(restrict)
  const atAllowedLocation = await tx
    .select({ employmentId: employmentLocations.employmentId })
    .from(employmentLocations)
    .where(
      and(
        eq(employmentLocations.organizationId, organizationId),
        inArray(employmentLocations.locationId, restrict.length > 0 ? restrict : ['']),
      ),
    )
  const reachable = new Set(atAllowedLocation.map((r) => r.employmentId))
  return people.filter(
    (p) => reachable.has(p.employmentId) || (p.locationId !== null && allowed.has(p.locationId)),
  )
}

/** Everyone a single rule matches. Only ever active, non-archived people. */
async function matchSelector(
  tx: Tx,
  organizationId: string,
  rule: AudienceRuleInput,
): Promise<string[]> {
  const activeOnly = and(
    eq(employments.organizationId, organizationId),
    isNull(employments.archivedAt),
    // Invited people are included: a new hire who has not accepted yet still
    // needs to receive the safety notice waiting for them.
    or(eq(employments.status, 'active'), eq(employments.status, 'invited')),
  )

  switch (rule.selectorType) {
    case 'organization': {
      const rows = await tx.select({ id: employments.id }).from(employments).where(activeOnly)
      return rows.map((r) => r.id)
    }

    case 'location': {
      if (!rule.selectorId) return []
      const rows = await tx
        .select({ id: employments.id })
        .from(employments)
        .innerJoin(
          employmentLocations,
          and(
            eq(employmentLocations.organizationId, employments.organizationId),
            eq(employmentLocations.employmentId, employments.id),
          ),
        )
        .where(and(activeOnly, eq(employmentLocations.locationId, rule.selectorId)))
      return rows.map((r) => r.id)
    }

    case 'job_role': {
      if (!rule.selectorId) return []
      const rows = await tx
        .select({ id: employments.id })
        .from(employments)
        .innerJoin(
          employmentJobRoles,
          and(
            eq(employmentJobRoles.organizationId, employments.organizationId),
            eq(employmentJobRoles.employmentId, employments.id),
          ),
        )
        .where(and(activeOnly, eq(employmentJobRoles.jobRoleId, rule.selectorId)))
      return rows.map((r) => r.id)
    }

    case 'department': {
      if (!rule.selectorId) return []
      // A department contains job roles; people belong to roles.
      const rows = await tx
        .select({ id: employments.id })
        .from(employments)
        .innerJoin(
          employmentJobRoles,
          and(
            eq(employmentJobRoles.organizationId, employments.organizationId),
            eq(employmentJobRoles.employmentId, employments.id),
          ),
        )
        .innerJoin(
          jobRoles,
          and(
            eq(jobRoles.organizationId, employmentJobRoles.organizationId),
            eq(jobRoles.id, employmentJobRoles.jobRoleId),
          ),
        )
        .where(and(activeOnly, eq(jobRoles.departmentId, rule.selectorId)))
      return rows.map((r) => r.id)
    }

    case 'team': {
      if (!rule.selectorId) return []
      const rows = await tx
        .select({ id: employments.id })
        .from(employments)
        .innerJoin(
          employmentTeams,
          and(
            eq(employmentTeams.organizationId, employments.organizationId),
            eq(employmentTeams.employmentId, employments.id),
          ),
        )
        .where(and(activeOnly, eq(employmentTeams.teamId, rule.selectorId)))
      return rows.map((r) => r.id)
    }

    case 'station': {
      if (!rule.selectorId) return []
      /*
       * A station is a place to work during a shift, not a roster. Nobody is
       * "a member of" the bar. So targeting a work position means the people
       * who could be put on it: everyone at that station's location who holds
       * its job role, or everyone at that location if the station has no role.
       *
       * When scheduling lands and shifts assign people to stations, this
       * becomes answerable precisely; the selector type does not change.
       */
      const [station] = await tx
        .select({ locationId: stations.locationId, jobRoleId: stations.jobRoleId })
        .from(stations)
        .where(and(eq(stations.organizationId, organizationId), eq(stations.id, rule.selectorId)))
        .limit(1)
      if (!station) return []

      const base = tx
        .select({ id: employments.id })
        .from(employments)
        .innerJoin(
          employmentLocations,
          and(
            eq(employmentLocations.organizationId, employments.organizationId),
            eq(employmentLocations.employmentId, employments.id),
          ),
        )

      if (!station.jobRoleId) {
        const rows = await base.where(
          and(activeOnly, eq(employmentLocations.locationId, station.locationId)),
        )
        return rows.map((r) => r.id)
      }

      const rows = await tx
        .select({ id: employments.id })
        .from(employments)
        .innerJoin(
          employmentLocations,
          and(
            eq(employmentLocations.organizationId, employments.organizationId),
            eq(employmentLocations.employmentId, employments.id),
          ),
        )
        .innerJoin(
          employmentJobRoles,
          and(
            eq(employmentJobRoles.organizationId, employments.organizationId),
            eq(employmentJobRoles.employmentId, employments.id),
          ),
        )
        .where(
          and(
            activeOnly,
            eq(employmentLocations.locationId, station.locationId),
            eq(employmentJobRoles.jobRoleId, station.jobRoleId),
          ),
        )
      return rows.map((r) => r.id)
    }

    case 'employment': {
      if (!rule.selectorId) return []
      const rows = await tx
        .select({ id: employments.id })
        .from(employments)
        .where(and(activeOnly, eq(employments.id, rule.selectorId)))
      return rows.map((r) => r.id)
    }
  }
}

/** Names plus the snapshot fields a recipient row records. */
async function describePeople(
  tx: Tx,
  organizationId: string,
  employmentIds: string[],
): Promise<ResolvedPerson[]> {
  if (employmentIds.length === 0) return []

  const people = await tx
    .select({
      employmentId: employments.id,
      displayName: employments.displayName,
      locationId: employments.homeLocationId,
    })
    .from(employments)
    .where(
      and(eq(employments.organizationId, organizationId), inArray(employments.id, employmentIds)),
    )

  const roleRows = await tx
    .select({
      employmentId: employmentJobRoles.employmentId,
      jobRoleId: employmentJobRoles.jobRoleId,
      isPrimary: employmentJobRoles.isPrimary,
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
        inArray(employmentJobRoles.employmentId, employmentIds),
      ),
    )

  const primaryRole = new Map<string, { jobRoleId: string; departmentId: string | null }>()
  for (const row of roleRows) {
    const existing = primaryRole.get(row.employmentId)
    if (!existing || row.isPrimary) {
      primaryRole.set(row.employmentId, {
        jobRoleId: row.jobRoleId,
        departmentId: row.departmentId,
      })
    }
  }

  return people
    .map((p) => ({
      employmentId: p.employmentId,
      displayName: p.displayName,
      locationId: p.locationId,
      jobRoleId: primaryRole.get(p.employmentId)?.jobRoleId ?? null,
      departmentId: primaryRole.get(p.employmentId)?.departmentId ?? null,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
}

/**
 * Turn rules into names. Also the tenant check: a selector belonging to
 * another organization simply does not resolve, and is reported as unknown
 * rather than silently ignored.
 */
export async function resolveSelectorLabels(
  tx: Tx,
  organizationId: string,
  rules: readonly AudienceRuleInput[],
): Promise<SelectorLabel[]> {
  const out: SelectorLabel[] = []

  for (const rule of rules) {
    if (rule.selectorType === 'organization') {
      out.push({ type: rule.selectorType, id: null, label: 'Everyone in the organization' })
      continue
    }
    if (!rule.selectorId) continue

    const label = await lookupLabel(tx, organizationId, rule.selectorType, rule.selectorId)
    if (label === null) {
      throw new ValidationError(
        { audience: ['One of the selected groups no longer exists.'] },
        'That audience refers to something that is not part of this organization.',
      )
    }
    out.push({ type: rule.selectorType, id: rule.selectorId, label })
  }

  return out
}

async function lookupLabel(
  tx: Tx,
  organizationId: string,
  type: AudienceSelectorType,
  id: string,
): Promise<string | null> {
  switch (type) {
    case 'location': {
      const [r] = await tx
        .select({ name: locations.name })
        .from(locations)
        .where(and(eq(locations.organizationId, organizationId), eq(locations.id, id)))
        .limit(1)
      return r?.name ?? null
    }
    case 'department': {
      const [r] = await tx
        .select({ name: departments.name })
        .from(departments)
        .where(and(eq(departments.organizationId, organizationId), eq(departments.id, id)))
        .limit(1)
      return r ? `${r.name} department` : null
    }
    case 'job_role': {
      const [r] = await tx
        .select({ name: jobRoles.name })
        .from(jobRoles)
        .where(and(eq(jobRoles.organizationId, organizationId), eq(jobRoles.id, id)))
        .limit(1)
      return r?.name ?? null
    }
    case 'team': {
      const [r] = await tx
        .select({ name: teams.name })
        .from(teams)
        .where(and(eq(teams.organizationId, organizationId), eq(teams.id, id)))
        .limit(1)
      return r ? `${r.name} team` : null
    }
    case 'station': {
      const [r] = await tx
        .select({ name: stations.name })
        .from(stations)
        .where(and(eq(stations.organizationId, organizationId), eq(stations.id, id)))
        .limit(1)
      return r ? `${r.name} station` : null
    }
    case 'employment': {
      const [r] = await tx
        .select({ name: employments.displayName })
        .from(employments)
        .where(and(eq(employments.organizationId, organizationId), eq(employments.id, id)))
        .limit(1)
      return r?.name ?? null
    }
    case 'organization':
      return 'Everyone in the organization'
  }
}

/**
 * A sentence a manager can check before they publish.
 *
 * Deliberately plain: "Everyone at Riverside, except the Kitchen department"
 * rather than a chip cloud whose meaning depends on knowing the combination
 * rules.
 */
export function describeAudience(
  labels: readonly SelectorLabel[],
  rules: readonly AudienceRuleInput[],
): string {
  const includeLabels: string[] = []
  const excludeLabels: string[] = []

  let cursor = 0
  for (const rule of rules) {
    if (rule.selectorType !== 'organization' && !rule.selectorId) continue
    const label = labels[cursor]?.label
    cursor += 1
    if (!label) continue
    if (rule.mode === 'include') includeLabels.push(label)
    else excludeLabels.push(label)
  }

  if (includeLabels.length === 0) return 'Nobody yet — add at least one group.'

  const included = joinWithAnd(includeLabels)
  if (excludeLabels.length === 0) return included
  return `${included}, except ${joinWithAnd(excludeLabels)}`
}

function joinWithAnd(items: string[]): string {
  if (items.length === 1) return items[0] ?? ''
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}
