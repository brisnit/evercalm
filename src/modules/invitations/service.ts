import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { and, count, desc, eq, gte, sql } from 'drizzle-orm'
import {
  employmentJobRoles,
  employmentLocations,
  employments,
  invitations,
  locations,
  roleGrants,
  roles,
} from '@/server/db/schema'
import type { Db, Tx } from '@/server/db'
import { newId } from '@/lib/ids'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { authorize, can } from '@/server/authz/can'
import type { Actor } from '@/server/authz/actor'
import { AUDIT_ACTIONS, recordAuditEvent } from '@/server/audit'
import { findEmploymentByEmailInTenant } from '@/modules/people/service'

/**
 * INVITATIONS.
 *
 * Security model, stated once so the code below can be read against it:
 *
 *  1. The token is 32 random bytes, base64url. Only its SHA-256 is stored, so
 *     a database dump yields no working links.
 *  2. Lookup is constant-time on the hash and returns nothing for an
 *     accepted, revoked, or expired invitation - a replayed link is inert.
 *  3. Acceptance and employment creation happen in ONE transaction, so a
 *     token cannot be used twice even under a race.
 *  4. Nothing is granted until acceptance. The invitation stores intent.
 *  5. No enumeration: inviting an address that already has an EverCalm
 *     account looks identical to inviting one that does not, and errors never
 *     distinguish "already invited elsewhere" from "available".
 *  6. Rate limited per organization, and per invitation for resends.
 */

const TOKEN_BYTES = 32
const DEFAULT_EXPIRY_DAYS = 14
/** Invitations one organization may create per rolling hour. */
const ORG_HOURLY_LIMIT = 50
/** Minimum gap between resends of the same invitation. */
const RESEND_COOLDOWN_MS = 60_000

export interface IssuedInvitation {
  invitationId: string
  /** Returned ONCE, for the link. Never stored, never logged. */
  token: string
  expiresAt: Date
  acceptUrl: string
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

/** Constant-time comparison, for callers verifying a presented token. */
export function tokenMatchesHash(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashToken(token), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

export interface CreateInvitationInput {
  email: string
  displayName: string
  jobTitle?: string
  roleKey: string
  scope: 'org' | 'location'
  scopeLocationId?: string | null
  homeLocationId?: string | null
  locationIds: string[]
  jobRoleIds: string[]
  expiresInDays?: number
  /**
   * Set when inviting somebody who ALREADY has an employment record, which is
   * how bulk import works. Acceptance links to it instead of creating a second
   * person.
   */
  targetEmploymentId?: string | null
}

export interface InvitationSummary {
  id: string
  email: string
  displayName: string
  jobTitle: string | null
  roleName: string
  scope: string
  scopeLocationName: string | null
  status: string
  expiresAt: Date
  sendCount: number
  lastSentAt: Date
  acceptedAt: Date | null
  invitedBy: string | null
}

/**
 * Effective status, computed rather than stored: an invitation whose expiry
 * has passed is expired whether or not a job has swept it yet.
 */
export function effectiveStatus(row: {
  status: string
  expiresAt: Date
}): 'pending' | 'accepted' | 'revoked' | 'expired' {
  if (row.status === 'accepted') return 'accepted'
  if (row.status === 'revoked') return 'revoked'
  if (row.expiresAt.getTime() <= Date.now()) return 'expired'
  return 'pending'
}

async function assertWithinOrgRateLimit(tx: Tx, organizationId: string): Promise<void> {
  const since = new Date(Date.now() - 60 * 60 * 1000)
  const [row] = await tx
    .select({ total: count() })
    .from(invitations)
    .where(and(eq(invitations.organizationId, organizationId), gte(invitations.createdAt, since)))

  if ((row?.total ?? 0) >= ORG_HOURLY_LIMIT) {
    throw new ValidationError(
      { email: ['Too many invitations sent in the last hour. Try again shortly.'] },
      'Invitation rate limit reached',
    )
  }
}

export async function createInvitation(
  tx: Tx,
  actor: Actor,
  input: CreateInvitationInput,
  appUrl: string,
): Promise<IssuedInvitation> {
  authorize(actor, 'people.invite', { locationId: input.scopeLocationId ?? null })

  // A location-scoped inviter may only invite into their own location.
  if (input.scope === 'location' && input.scopeLocationId) {
    authorize(actor, 'people.invite', { locationId: input.scopeLocationId })
  } else {
    authorize(actor, 'people.invite')
  }

  const email = input.email.trim().toLowerCase()

  await assertWithinOrgRateLimit(tx, actor.organizationId)

  // Already a colleague? This is a tenant-scoped question only - it can never
  // reveal that the address is used at another organization.
  //
  // Skipped when the caller is deliberately inviting an existing record, which
  // is exactly what a bulk import does: the person is in the directory but has
  // no account yet.
  if (!input.targetEmploymentId) {
    const existing = await findEmploymentByEmailInTenant(tx, actor, email)
    if (existing) {
      throw new ValidationError(
        { email: [`${existing.displayName} is already part of this organization.`] },
        'Already a colleague',
      )
    }
  }

  const openInvite = await tx
    .select({ id: invitations.id })
    .from(invitations)
    .where(
      and(
        eq(invitations.organizationId, actor.organizationId),
        eq(invitations.email, email),
        eq(invitations.status, 'pending'),
      ),
    )
    .limit(1)
  if (openInvite[0]) {
    throw new ValidationError(
      { email: ['There is already an open invitation for this address. Resend it instead.'] },
      'Already invited',
    )
  }

  const [role] = await tx
    .select({ id: roles.id, name: roles.name })
    .from(roles)
    .where(and(eq(roles.organizationId, actor.organizationId), eq(roles.key, input.roleKey)))
    .limit(1)
  if (!role) throw new NotFoundError('That role does not exist in this organization')

  // Every referenced location must belong to THIS tenant. RLS already
  // guarantees it, but validating here produces a useful error rather than a
  // foreign-key failure.
  const validLocations = await tx
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.organizationId, actor.organizationId))
  const validIds = new Set(validLocations.map((l) => l.id))
  for (const id of [...input.locationIds, input.scopeLocationId, input.homeLocationId]) {
    if (id && !validIds.has(id)) throw new NotFoundError('Unknown location')
  }

  const token = generateToken()
  const invitationId = newId()
  const expiresAt = new Date(
    Date.now() + (input.expiresInDays ?? DEFAULT_EXPIRY_DAYS) * 24 * 60 * 60 * 1000,
  )

  await tx.insert(invitations).values({
    id: invitationId,
    organizationId: actor.organizationId,
    email,
    displayName: input.displayName.trim(),
    jobTitle: input.jobTitle?.trim() || null,
    tokenHash: hashToken(token),
    roleId: role.id,
    roleScope: input.scope,
    scopeLocationId: input.scope === 'location' ? (input.scopeLocationId ?? null) : null,
    homeLocationId: input.homeLocationId ?? null,
    locationIds: input.locationIds,
    jobRoleIds: input.jobRoleIds,
    status: 'pending',
    expiresAt,
    invitedByEmploymentId: actor.employmentId,
    targetEmploymentId: input.targetEmploymentId ?? null,
  })

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.INVITATION_SENT,
    summary: `Invited ${input.displayName.trim()} as ${role.name}`,
    subjectType: 'invitation',
    subjectId: invitationId,
    locationId: input.scopeLocationId ?? null,
    // The address is deliberately absent: audit metadata must not become a
    // searchable store of personal contact details.
    metadata: { role: input.roleKey, scope: input.scope },
  })

  return {
    invitationId,
    token,
    expiresAt,
    acceptUrl: `${appUrl.replace(/\/$/, '')}/invite/${token}`,
  }
}

export async function listInvitations(tx: Tx, actor: Actor): Promise<InvitationSummary[]> {
  authorize(actor, 'people.invite')

  const rows = await tx
    .select({
      id: invitations.id,
      email: invitations.email,
      displayName: invitations.displayName,
      jobTitle: invitations.jobTitle,
      roleName: roles.name,
      scope: invitations.roleScope,
      scopeLocationName: locations.name,
      status: invitations.status,
      expiresAt: invitations.expiresAt,
      sendCount: invitations.sendCount,
      lastSentAt: invitations.lastSentAt,
      acceptedAt: invitations.acceptedAt,
      invitedBy: employments.displayName,
    })
    .from(invitations)
    .innerJoin(
      roles,
      and(eq(roles.id, invitations.roleId), eq(roles.organizationId, invitations.organizationId)),
    )
    .leftJoin(
      locations,
      and(
        eq(locations.id, invitations.scopeLocationId),
        eq(locations.organizationId, invitations.organizationId),
      ),
    )
    .leftJoin(
      employments,
      and(
        eq(employments.id, invitations.invitedByEmploymentId),
        eq(employments.organizationId, invitations.organizationId),
      ),
    )
    .where(eq(invitations.organizationId, actor.organizationId))
    .orderBy(desc(invitations.createdAt))

  return rows.map((r) => ({ ...r, status: effectiveStatus(r) }))
}

/** Issues a NEW token, so any previously sent link stops working. */
export async function resendInvitation(
  tx: Tx,
  actor: Actor,
  invitationId: string,
  appUrl: string,
): Promise<IssuedInvitation> {
  authorize(actor, 'people.invite')

  const [row] = await tx
    .select()
    .from(invitations)
    .where(
      and(eq(invitations.organizationId, actor.organizationId), eq(invitations.id, invitationId)),
    )
    .limit(1)
  if (!row) throw new NotFoundError('Invitation not found')

  if (row.status === 'accepted') {
    throw new ValidationError({}, 'That invitation has already been accepted.')
  }
  if (row.status === 'revoked') {
    throw new ValidationError({}, 'That invitation was revoked. Send a new one instead.')
  }
  if (Date.now() - row.lastSentAt.getTime() < RESEND_COOLDOWN_MS) {
    throw new ValidationError({}, 'That invitation was just sent. Wait a minute before resending.')
  }

  const token = generateToken()
  const expiresAt = new Date(Date.now() + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000)

  await tx
    .update(invitations)
    .set({
      // Replacing the hash invalidates the old link, which matters if the
      // original was forwarded or leaked.
      tokenHash: hashToken(token),
      expiresAt,
      status: 'pending',
      sendCount: row.sendCount + 1,
      lastSentAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(eq(invitations.organizationId, actor.organizationId), eq(invitations.id, invitationId)),
    )

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.INVITATION_RESENT,
    summary: `Resent the invitation for ${row.displayName}`,
    subjectType: 'invitation',
    subjectId: invitationId,
    metadata: { sendCount: row.sendCount + 1 },
  })

  return {
    invitationId,
    token,
    expiresAt,
    acceptUrl: `${appUrl.replace(/\/$/, '')}/invite/${token}`,
  }
}

export async function revokeInvitation(tx: Tx, actor: Actor, invitationId: string): Promise<void> {
  authorize(actor, 'people.invite')

  const [row] = await tx
    .select({
      id: invitations.id,
      displayName: invitations.displayName,
      status: invitations.status,
    })
    .from(invitations)
    .where(
      and(eq(invitations.organizationId, actor.organizationId), eq(invitations.id, invitationId)),
    )
    .limit(1)
  if (!row) throw new NotFoundError('Invitation not found')
  if (row.status === 'accepted') {
    throw new ValidationError(
      {},
      'That invitation has already been accepted and cannot be revoked.',
    )
  }

  await tx
    .update(invitations)
    .set({
      status: 'revoked',
      revokedAt: new Date(),
      revokedByEmploymentId: actor.employmentId,
      // Clearing the hash to a dead value makes any outstanding link useless
      // immediately, not merely status-checked.
      tokenHash: `revoked:${newId()}`,
      updatedAt: new Date(),
    })
    .where(
      and(eq(invitations.organizationId, actor.organizationId), eq(invitations.id, invitationId)),
    )

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.INVITATION_REVOKED,
    summary: `Revoked the invitation for ${row.displayName}`,
    subjectType: 'invitation',
    subjectId: invitationId,
  })
}

export interface InvitationPreview {
  organizationId: string
  expiresAt: Date
}

/**
 * Resolve a presented token to the organization it belongs to.
 *
 * Runs BEFORE any tenant context exists, through the SECURITY DEFINER
 * function in migration 0005. Returns null for anything that is not a live,
 * pending, unexpired invitation - so accepted, revoked and expired links are
 * indistinguishable from invented ones.
 */
export async function previewInvitation(db: Db, token: string): Promise<InvitationPreview | null> {
  if (!token || token.length < 20) return null

  // The SECURITY DEFINER function returns the organization id and the expiry
  // and NOTHING else - no name, no email, no invitation id. See migration 0009.
  const result = await db.execute<{ organization_id: string; expires_at: Date }>(
    sql`select * from evercalm_invitation_by_token(${hashToken(token)})`,
  )

  const row = result.rows[0]
  if (!row) return null
  return { organizationId: row.organization_id, expiresAt: row.expires_at }
}

/**
 * The organization's display name, read through the ORDINARY tenant-scoped
 * path once the token has established which tenant it is.
 *
 * Kept out of the definer function deliberately: that function should leak the
 * bare minimum, and by this point the caller has already proved they hold a
 * live invitation to this organization.
 */
export async function organizationNameForInvite(
  tx: Tx,
  organizationId: string,
): Promise<string | null> {
  const result = await tx.execute<{ name: string }>(
    sql`select name from organizations where id = ${organizationId}`,
  )
  return result.rows[0]?.name ?? null
}

export interface AcceptInvitationResult {
  employmentId: string
  organizationId: string
  organizationName: string
  displayName: string
}

/**
 * Accept an invitation and create the employment.
 *
 * Runs inside ONE transaction with a conditional update that only matches a
 * still-pending invitation. Two simultaneous acceptances therefore produce one
 * employment and one failure, not two employments.
 */
export async function acceptInvitation(
  tx: Tx,
  organizationId: string,
  token: string,
  userId: string,
): Promise<AcceptInvitationResult> {
  const tokenHash = hashToken(token)

  const [invitation] = await tx
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.organizationId, organizationId),
        eq(invitations.tokenHash, tokenHash),
        eq(invitations.status, 'pending'),
      ),
    )
    .limit(1)

  if (!invitation) throw new NotFoundError('This invitation is no longer valid')
  if (invitation.expiresAt.getTime() <= Date.now()) {
    throw new NotFoundError('This invitation has expired')
  }

  // Claim it first. The WHERE clause is the race guard: a second acceptance
  // matches zero rows because the status is no longer 'pending'.
  const employmentId = invitation.targetEmploymentId ?? newId()
  const claimed = await tx
    .update(invitations)
    .set({
      status: 'accepted',
      acceptedAt: new Date(),
      acceptedEmploymentId: employmentId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(invitations.organizationId, organizationId),
        eq(invitations.id, invitation.id),
        eq(invitations.status, 'pending'),
      ),
    )
    .returning({ id: invitations.id })

  if (claimed.length === 0) throw new NotFoundError('This invitation is no longer valid')

  if (invitation.targetEmploymentId) {
    // The person already exists - typically from a bulk import. Link the
    // identity to that record rather than creating a second one, and leave
    // everything an administrator already set about them alone.
    await tx
      .update(employments)
      .set({ userId, status: 'active', updatedAt: new Date() })
      .where(
        and(
          eq(employments.organizationId, organizationId),
          eq(employments.id, invitation.targetEmploymentId),
        ),
      )
  } else {
    await tx.insert(employments).values({
      id: employmentId,
      organizationId,
      userId,
      displayName: invitation.displayName,
      jobTitle: invitation.jobTitle,
      status: 'active',
      email: invitation.email,
      homeLocationId: invitation.homeLocationId,
      hiredOn: new Date().toISOString().slice(0, 10),
    })
  }

  for (const locationId of invitation.locationIds) {
    await tx.insert(employmentLocations).values({
      id: newId(),
      organizationId,
      employmentId,
      locationId,
    })
  }

  for (const [index, jobRoleId] of invitation.jobRoleIds.entries()) {
    await tx.insert(employmentJobRoles).values({
      id: newId(),
      organizationId,
      employmentId,
      jobRoleId,
      isPrimary: index === 0,
    })
  }

  await tx.insert(roleGrants).values({
    id: newId(),
    organizationId,
    employmentId,
    roleId: invitation.roleId,
    scope: invitation.roleScope,
    locationId: invitation.scopeLocationId,
    grantedByEmploymentId: invitation.invitedByEmploymentId,
  })

  const [organization] = await tx
    .execute<{ name: string }>(sql`select name from organizations where id = ${organizationId}`)
    .then((r) => r.rows)

  return {
    employmentId,
    organizationId,
    organizationName: organization?.name ?? 'your workspace',
    displayName: invitation.displayName,
  }
}

/** Whether the actor may see invitation management at all. */
export function canManageInvitations(actor: Actor): boolean {
  return can(actor, 'people.invite') || can(actor, 'people.invite', { locationId: null })
}

export { ForbiddenError }

/**
 * The invited person's identity details, for account creation only.
 *
 * Deliberately NOT returned to the browser. The acceptance page shows the
 * organization name and asks for a password; the email comes from the
 * invitation itself, so the page can never be used to discover which address
 * an invitation belongs to.
 */
export async function invitationIdentity(
  tx: Tx,
  organizationId: string,
  token: string,
): Promise<{ email: string; displayName: string } | null> {
  const [row] = await tx
    .select({ email: invitations.email, displayName: invitations.displayName })
    .from(invitations)
    .where(
      and(
        eq(invitations.organizationId, organizationId),
        eq(invitations.tokenHash, hashToken(token)),
        eq(invitations.status, 'pending'),
      ),
    )
    .limit(1)
  return row ?? null
}
