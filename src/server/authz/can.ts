import { ForbiddenError } from '@/lib/errors'
import type { Actor, ResolvedGrant } from './actor'
import type { Capability } from './capabilities'
import { isLocationScopable } from './capabilities'

/**
 * THE AUTHORIZATION GATE.
 *
 * Scope semantics, stated precisely because the subtlety here is where
 * multi-location permission bugs live:
 *
 *   can(actor, cap)                      -> "org-wide". Satisfied ONLY by an
 *                                           organization-scoped grant.
 *   can(actor, cap, { locationId: 'x' }) -> "at location x". Satisfied by an
 *                                           org-scoped grant, or by a
 *                                           location grant for exactly x.
 *
 * A General Manager at Riverside therefore cannot act on Downtown, even
 * though both locations belong to the same organization. Asking without a
 * location is NOT a wildcard - it is the stronger question.
 */

export interface ScopeQuery {
  /** The location the action targets. Omit for organization-level actions. */
  locationId?: string | null
}

function grantSatisfies(
  grant: ResolvedGrant,
  capability: Capability,
  locationId: string | null | undefined,
): boolean {
  if (!grant.capabilities.has(capability)) return false

  if (grant.scope === 'org') return true

  // A location grant can never satisfy an organization-level question.
  if (locationId === undefined || locationId === null) return false

  // Defence in depth: a location grant must never carry a capability that is
  // not location-scopable, even if bad data put one there.
  if (!isLocationScopable(capability)) return false

  return grant.locationId === locationId
}

export function can(actor: Actor, capability: Capability, scope: ScopeQuery = {}): boolean {
  return actor.grants.some((g) => grantSatisfies(g, capability, scope.locationId))
}

/** True if the actor holds the capability at ANY location (or org-wide). */
export function canAtAnyLocation(actor: Actor, capability: Capability): boolean {
  return actor.grants.some((g) => g.capabilities.has(capability))
}

/** Locations where the actor holds the capability. `null` means org-wide. */
export function accessibleLocationIds(actor: Actor, capability: Capability): string[] | null {
  const locationIds = new Set<string>()
  for (const grant of actor.grants) {
    if (!grant.capabilities.has(capability)) continue
    if (grant.scope === 'org') return null
    if (grant.locationId) locationIds.add(grant.locationId)
  }
  return [...locationIds]
}

/** Throws ForbiddenError when the actor lacks the capability. */
export function authorize(actor: Actor, capability: Capability, scope: ScopeQuery = {}): void {
  if (!can(actor, capability, scope)) {
    throw new ForbiddenError(capability)
  }
}

/**
 * Self-access is ownership, not capability. An employee needs no capability to
 * read or change their own record, which is what keeps the Employee role
 * preset genuinely empty.
 */
export function isSelf(actor: Actor, employmentId: string): boolean {
  return actor.employmentId === employmentId
}

export function authorizeSelfOr(
  actor: Actor,
  employmentId: string,
  capability: Capability,
  scope: ScopeQuery = {},
): void {
  if (isSelf(actor, employmentId)) return
  authorize(actor, capability, scope)
}

/** Every capability the actor holds anywhere. For rendering navigation. */
export function heldCapabilities(actor: Actor): Set<Capability> {
  const out = new Set<Capability>()
  for (const grant of actor.grants) for (const c of grant.capabilities) out.add(c)
  return out
}
