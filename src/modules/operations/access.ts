import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import type { Tx } from '@/server/db'
import { locations } from '@/server/db/schema'
import type { Actor, Capability } from '@/server/authz'
import { accessibleLocationIds, can, canAtAnyLocation } from '@/server/authz/can'
import { ForbiddenError, NotFoundError } from '@/lib/errors'

/*
 * WHO MAY SEE AND DO WHAT IN SHIFT OPERATIONS.
 *
 * Every operations capability is location-scopable. A General Manager at
 * Riverside runs Riverside's shifts; a Shift Lead verifies and reassigns work
 * on the floor they lead. Nothing at Downtown is visible to either.
 *
 *   checklist.author      build templates for the locations you hold it at
 *   checklist.view_runs   the operational board
 *   checklist.verify      verify, send back, reassign
 *   checklist.reopen      reopen finished or skipped work
 *   handoff.manage        resolve and reopen handoffs; leave one without a shift
 *
 * The same two answers as scheduling and training:
 *
 *   NotFound   the location, run, task or handoff is outside every operations
 *              scope the actor holds - the answer another tenant's rows give.
 *   Forbidden  it is visible, but this capability is not held there.
 *
 * Employees need no capability for the work on their own shifts. That is
 * ownership, checked by comparing employment ids.
 */

export const OPERATIONS_CAPABILITIES: readonly Capability[] = [
  'checklist.author',
  'checklist.view_runs',
  'checklist.verify',
  'checklist.reopen',
  'handoff.manage',
]

export interface LocationRef {
  id: string
  name: string
  timeZone: string
}

export function canUseOperationsAdmin(actor: Actor): boolean {
  return OPERATIONS_CAPABILITIES.some((c) => canAtAnyLocation(actor, c))
}

export function canSeeOperationsAt(actor: Actor, locationId: string): boolean {
  return OPERATIONS_CAPABILITIES.some((c) => can(actor, c, { locationId }))
}

/** Locations where the actor holds `capability`; `null` is organization-wide. */
export function scopeOf(actor: Actor, capability: Capability): string[] | null {
  return accessibleLocationIds(actor, capability)
}

export async function loadLocationRefs(
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

/** Active locations where the actor holds `capability`, by name. */
export async function operationsLocations(
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

/** Management access to one location. See the module comment for NotFound vs Forbidden. */
export async function requireOperationsAt(
  tx: Tx,
  actor: Actor,
  locationId: string,
  capability: Capability,
): Promise<LocationRef> {
  const location = (await loadLocationRefs(tx, actor.organizationId, [locationId])).get(locationId)
  if (!location || !canSeeOperationsAt(actor, locationId)) {
    throw new NotFoundError('Location not found')
  }
  if (!can(actor, capability, { locationId })) throw new ForbiddenError(capability)
  return location
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

/** Raised when a task changed between reading it and acting on it. */
export class StaleTaskError extends Error {
  constructor() {
    super('This task changed while you were looking at it.')
    this.name = 'StaleTaskError'
  }
}
