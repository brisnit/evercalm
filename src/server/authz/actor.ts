import type { Capability } from './capabilities'
import type { GrantScope } from './role-presets'

/**
 * The resolved permissions of one person inside one organization.
 *
 * An Actor is always tenant-scoped: it is built from an employment, not a
 * user. A person who works for two customers has two Actors and they share
 * nothing.
 */

export interface ResolvedGrant {
  readonly roleId: string
  readonly roleKey: string
  readonly roleName: string
  readonly scope: GrantScope
  /** Present only when scope === 'location'. */
  readonly locationId: string | null
  readonly capabilities: ReadonlySet<Capability>
}

export interface Actor {
  readonly userId: string
  readonly organizationId: string
  readonly employmentId: string
  readonly displayName: string
  readonly grants: readonly ResolvedGrant[]
  /** Locations this person is assigned to, independent of permissions. */
  readonly locationIds: readonly string[]
}

/** A system actor for background jobs. Used for attribution, never to skip checks. */
export interface SystemActor {
  readonly kind: 'system'
  readonly organizationId: string
  readonly reason: string
}

export function isSystemActor(actor: Actor | SystemActor): actor is SystemActor {
  return 'kind' in actor && actor.kind === 'system'
}
