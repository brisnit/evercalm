import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import type { Tx } from '@/server/db'
import { employmentLocations, locations } from '@/server/db/schema'
import type { Actor, Capability } from '@/server/authz'
import { accessibleLocationIds, can, canAtAnyLocation } from '@/server/authz/can'
import { ForbiddenError, NotFoundError } from '@/lib/errors'

/*
 * WHO MAY SEE AND DO WHAT IN TRAINING.
 *
 * Two kinds of capability, and the difference is the whole design:
 *
 *   CONTENT   training.author, training.publish - organization-wide. A course
 *             is the organization's, not a location's: the allergen course is
 *             the same course at Riverside and Downtown.
 *   PEOPLE    training.assign, training.view_progress_team, skill.verify -
 *             location-scopable. A General Manager at Riverside assigns,
 *             follows and signs off the people who work at Riverside.
 *             training.view_progress_org is the organization-wide read.
 *
 * The same two answers as scheduling:
 *
 *   NotFound   a person (or their assignment) is outside every training scope
 *              the actor holds - the answer another tenant's rows also give.
 *   Forbidden  the actor can see them, but lacks this particular capability.
 *
 * Employees need no capability for their own training. Self-access is
 * ownership, and is checked by comparing employment ids, never by role.
 */

/** Anything that opens some part of training administration. */
export const TRAINING_CAPABILITIES: readonly Capability[] = [
  'training.author',
  'training.publish',
  'training.assign',
  'training.view_progress_team',
  'training.view_progress_org',
  'skill.verify',
]

/** Capabilities that let a manager see a person's training at all. */
const PERSON_VISIBILITY: readonly Capability[] = [
  'training.assign',
  'training.view_progress_team',
  'training.view_progress_org',
  'skill.verify',
]

export const PROGRESS_CAPABILITIES: readonly Capability[] = [
  'training.view_progress_team',
  'training.view_progress_org',
]

export function canUseTrainingAdmin(actor: Actor): boolean {
  return TRAINING_CAPABILITIES.some((c) => canAtAnyLocation(actor, c))
}

/** Authors and publishers see drafts; everyone else in training sees published content only. */
export function canSeeDrafts(actor: Actor): boolean {
  return can(actor, 'training.author') || can(actor, 'training.publish')
}

export function canViewProgressAnywhere(actor: Actor): boolean {
  return PROGRESS_CAPABILITIES.some((c) => canAtAnyLocation(actor, c))
}

/**
 * Locations where ANY of `capabilities` is held. `null` means organization-wide.
 * `view_progress_org` is never location-scoped, so it simply widens to null.
 */
export function scopeFor(actor: Actor, capabilities: readonly Capability[]): string[] | null {
  const ids = new Set<string>()
  for (const capability of capabilities) {
    const scope = accessibleLocationIds(actor, capability)
    if (scope === null) return null
    for (const id of scope) ids.add(id)
  }
  return [...ids]
}

export function progressScope(actor: Actor): string[] | null {
  return scopeFor(actor, PROGRESS_CAPABILITIES)
}

export interface LocationRef {
  id: string
  name: string
  timeZone: string
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
 * A manager acting on one person's training.
 *
 * Returns the person's locations where the actor holds `capability`, so the
 * caller can record which location the action was taken for. Outside every
 * training scope: NotFound. Visible but without the capability: Forbidden.
 */
export async function requirePersonCapability(
  tx: Tx,
  actor: Actor,
  employmentId: string,
  capability: Capability,
): Promise<string[]> {
  const personLocations = await personLocationIds(tx, actor.organizationId, employmentId)
  const visible = personLocations.some((locationId) =>
    PERSON_VISIBILITY.some((c) => can(actor, c, { locationId })),
  )
  if (!visible && !can(actor, 'training.view_progress_org')) {
    throw new NotFoundError('Person not found')
  }
  const allowed = personLocations.filter((locationId) => can(actor, capability, { locationId }))
  if (allowed.length === 0) throw new ForbiddenError(capability)
  return allowed
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
/** Raised by the triggers that freeze a published version. */
export const FROZEN_VERSION = '55000'
