import { cache } from 'react'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from './index'
import { withTenant } from '@/server/db'
import { withGlobal } from '@/server/db/global'
import { listMemberships, resolveActor, type Membership } from '@/server/authz/resolve'
import type { Actor } from '@/server/authz/actor'

/**
 * Request-scoped session and actor resolution.
 *
 * The active organization is held in a cookie, but the cookie is NEVER
 * trusted: it is checked against the user's real memberships on every
 * request. A forged cookie naming another tenant resolves to no membership
 * and falls back to one the user actually holds.
 */

const ACTIVE_ORG_COOKIE = 'evercalm_active_org'

export interface SessionUser {
  id: string
  email: string
  name: string
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth().api.getSession({ headers: await headers() })
  if (!session?.user) return null
  return { id: session.user.id, email: session.user.email, name: session.user.name }
}

export async function getMemberships(userId: string): Promise<Membership[]> {
  return withGlobal((db) => listMemberships(db, userId))
}

export interface ActorContext {
  user: SessionUser
  actor: Actor
  memberships: Membership[]
  activeOrganization: Membership
}

/**
 * Resolve the signed-in person's permissions in their active organization.
 * Returns null when not signed in or when the account has no membership.
 *
 * Cached for the duration of one server render, so a page and the header
 * around it resolve the actor once. Outside a render (a server action) it is
 * simply called.
 */
export const getActorContext = cache(async (): Promise<ActorContext | null> => {
  const user = await getSessionUser()
  if (!user) return null

  const memberships = await getMemberships(user.id)
  if (memberships.length === 0) return null

  const cookieStore = await cookies()
  const requested = cookieStore.get(ACTIVE_ORG_COOKIE)?.value

  // The cookie is a preference, not an authorization. Fall back to a real one.
  const activeOrganization =
    memberships.find((m) => m.organizationId === requested) ?? memberships[0]
  if (!activeOrganization) return null

  const actor = await withTenant(activeOrganization.organizationId, (tx) =>
    resolveActor(tx, activeOrganization.organizationId, user.id),
  )
  if (!actor) return null

  return { user, actor, memberships, activeOrganization }
})

/** Redirects to sign-in when there is no usable session. */
export async function requireActorContext(): Promise<ActorContext> {
  const context = await getActorContext()
  if (!context) redirect('/signin')
  return context
}

export { ACTIVE_ORG_COOKIE }
