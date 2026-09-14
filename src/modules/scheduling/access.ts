import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import type { Tx } from '@/server/db'
import { employmentLocations, locations } from '@/server/db/schema'
import type { Actor, Capability } from '@/server/authz'
import { accessibleLocationIds, can, isSelf } from '@/server/authz/can'
import { ForbiddenError, NotFoundError } from '@/lib/errors'

/*
 * WHO MAY SEE AND DO WHAT, AT WHICH LOCATION.
 *
 * Every scheduling capability is location-scopable. A General Manager at
 * Riverside manages Riverside's schedule and nothing at Downtown, even though
 * both locations belong to the same organization.
 *
 * Two answers, chosen deliberately:
 *
 *   NotFound   the location (or the person, or the shift) is outside every
 *              scheduling scope the actor holds. The same answer as "does not
 *              exist" - which is also what another tenant's rows return, via
 *              RLS - so a scope boundary cannot be probed.
 *   Forbidden  the actor can legitimately see it, but lacks this particular
 *              capability: a Scheduler looking at a schedule they may build
 *              but not publish is told so, not told it does not exist.
 */

export interface LocationRef {
  id: string
  name: string
  timeZone: string
}

/** Capabilities that each make a location's scheduling visible. */
const SCHEDULING_VISIBILITY: readonly Capability[] = [
  'schedule.view_all',
  'schedule.draft',
  'schedule.publish',
  'schedule.manage_templates',
  'availability.view_team',
  'timeoff.decide',
  'swap.decide',
  'openshift.manage',
]

export async function loadLocations(
  tx: Tx,
  organizationId: string,
  ids?: readonly string[],
): Promise<Map<string, LocationRef>> {
  if (ids && ids.length === 0) return new Map()
  const rows = await tx
    .select({ id: locations.id, name: locations.name, timeZone: locations.timezone })
    .from(locations)
    .where(
      and(
        eq(locations.organizationId, organizationId),
        ids ? inArray(locations.id, [...ids]) : undefined,
      ),
    )
  return new Map(rows.map((row) => [row.id, row]))
}

export async function requireLocation(
  tx: Tx,
  organizationId: string,
  locationId: string,
): Promise<LocationRef> {
  const location = (await loadLocations(tx, organizationId, [locationId])).get(locationId)
  if (!location) throw new NotFoundError('Location not found')
  return location
}

/** Active locations where the actor holds `capability`, by name. */
export async function locationsWhere(
  tx: Tx,
  actor: Actor,
  capability: Capability,
): Promise<LocationRef[]> {
  const scope = accessibleLocationIds(actor, capability)
  if (scope !== null && scope.length === 0) return []
  return tx
    .select({ id: locations.id, name: locations.name, timeZone: locations.timezone })
    .from(locations)
    .where(
      and(
        eq(locations.organizationId, actor.organizationId),
        isNull(locations.archivedAt),
        scope === null ? undefined : inArray(locations.id, scope),
      ),
    )
    .orderBy(asc(locations.name))
}

export function canSeeSchedulingAt(actor: Actor, locationId: string): boolean {
  return SCHEDULING_VISIBILITY.some((capability) => can(actor, capability, { locationId }))
}

/** Management access to one location. See the module comment for NotFound vs Forbidden. */
export async function requireLocationCapability(
  tx: Tx,
  actor: Actor,
  locationId: string,
  capability: Capability,
): Promise<LocationRef> {
  const location = await requireLocation(tx, actor.organizationId, locationId)
  if (!canSeeSchedulingAt(actor, locationId)) throw new NotFoundError('Location not found')
  if (!can(actor, capability, { locationId })) throw new ForbiddenError(capability)
  return location
}

export async function personLocationIds(
  tx: Tx,
  organizationId: string,
  employmentId: string,
): Promise<string[]> {
  const rows = await tx
    .select({ locationId: employmentLocations.locationId })
    .from(employmentLocations)
    .where(
      and(
        eq(employmentLocations.organizationId, organizationId),
        eq(employmentLocations.employmentId, employmentId),
      ),
    )
  return rows.map((row) => row.locationId)
}

/**
 * Self, or `capability` at one of the person's locations. Anyone else gets
 * NotFound: a manager at another site learns nothing about this person.
 */
export async function requireSelfOrCapabilityForPerson(
  tx: Tx,
  actor: Actor,
  employmentId: string,
  capability: Capability,
): Promise<void> {
  if (isSelf(actor, employmentId)) return
  const personLocations = await personLocationIds(tx, actor.organizationId, employmentId)
  if (!personLocations.some((locationId) => can(actor, capability, { locationId }))) {
    throw new NotFoundError('Person not found')
  }
}

/** The PostgreSQL error code, whether the driver error is raw or wrapped. */
export function pgErrorCode(error: unknown): string | undefined {
  for (let current: unknown = error, depth = 0; current && depth < 4; depth += 1) {
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code
    current = (current as { cause?: unknown }).cause
  }
  return undefined
}

export const UNIQUE_VIOLATION = '23505'
export const EXCLUSION_VIOLATION = '23P01'
