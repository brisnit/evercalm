import { auditEvents } from '@/server/db/schema'
import type { Db, Tx } from '@/server/db'
import { newId } from '@/lib/ids'
import type { Actor } from '@/server/authz/actor'

/**
 * APPEND-ONLY AUDIT.
 *
 * recordAuditEvent() takes the caller's transaction, so the audit row commits
 * or rolls back WITH the action it describes. There is no window in which an
 * action succeeded but went unrecorded, and none in which an audit row
 * describes something that never happened.
 *
 * The runtime role holds SELECT and INSERT on audit_events only; UPDATE and
 * DELETE are revoked at the database level.
 */

export const AUDIT_ACTIONS = {
  // identity (platform-scoped: no organization context at sign-in)
  SIGNED_IN: 'auth.signed_in',
  SIGN_IN_FAILED: 'auth.sign_in_failed',
  SIGNED_OUT: 'auth.signed_out',
  // organization
  ORGANIZATION_CREATED: 'organization.created',
  ORGANIZATION_UPDATED: 'organization.updated',
  LOCATION_CREATED: 'location.created',
  LOCATION_UPDATED: 'location.updated',
  LOCATION_ARCHIVED: 'location.archived',
  // people
  EMPLOYMENT_CREATED: 'employment.created',
  EMPLOYMENT_STATUS_CHANGED: 'employment.status_changed',
  // access
  ROLE_GRANTED: 'role_grant.granted',
  ROLE_REVOKED: 'role_grant.revoked',
  ROLE_CAPABILITIES_CHANGED: 'role.capabilities_changed',
  // access denials worth noticing
  PERMISSION_DENIED: 'access.denied',
} as const

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS]

export interface AuditContext {
  ipAddress?: string | null
  userAgent?: string | null
}

export interface RecordAuditInput {
  action: AuditAction
  summary: string
  subjectType?: string
  subjectId?: string
  locationId?: string | null
  /**
   * Structured detail. MUST NOT contain sensitive employee fields
   * (date of birth, emergency contacts, personal phone or email).
   */
  metadata?: Record<string, unknown>
  context?: AuditContext
}

/** Record a tenant-scoped event inside the caller's transaction. */
export async function recordAuditEvent(
  tx: Tx,
  actor: Actor,
  input: RecordAuditInput,
): Promise<void> {
  await tx.insert(auditEvents).values({
    id: newId(),
    organizationId: actor.organizationId,
    actorType: 'user',
    actorUserId: actor.userId,
    actorEmploymentId: actor.employmentId,
    actorLabel: actor.displayName,
    action: input.action,
    subjectType: input.subjectType ?? null,
    subjectId: input.subjectId ?? null,
    locationId: input.locationId ?? null,
    summary: input.summary,
    metadata: input.metadata ?? {},
    ipAddress: input.context?.ipAddress ?? null,
    userAgent: input.context?.userAgent ?? null,
  })
}

/** Record a tenant-scoped event attributed to the system, not a person. */
export async function recordSystemAuditEvent(
  tx: Tx,
  organizationId: string,
  input: RecordAuditInput & { reason: string },
): Promise<void> {
  await tx.insert(auditEvents).values({
    id: newId(),
    organizationId,
    actorType: 'system',
    actorLabel: input.reason,
    action: input.action,
    subjectType: input.subjectType ?? null,
    subjectId: input.subjectId ?? null,
    locationId: input.locationId ?? null,
    summary: input.summary,
    metadata: input.metadata ?? {},
  })
}

/**
 * Record a platform-scoped identity event (organization_id IS NULL).
 *
 * Sign-in is not an organization action - it happens before any tenant
 * context exists. These rows are invisible to every tenant because the
 * isolation policy matches on equality and NULL never equals a tenant id.
 */
export async function recordPlatformAuditEvent(
  db: Db,
  input: RecordAuditInput & { actorUserId?: string | null; actorLabel?: string },
): Promise<void> {
  await db.insert(auditEvents).values({
    id: newId(),
    organizationId: null,
    actorType: 'user',
    actorUserId: input.actorUserId ?? null,
    actorLabel: input.actorLabel ?? null,
    action: input.action,
    subjectType: input.subjectType ?? null,
    subjectId: input.subjectId ?? null,
    summary: input.summary,
    metadata: input.metadata ?? {},
    ipAddress: input.context?.ipAddress ?? null,
    userAgent: input.context?.userAgent ?? null,
  })
}
