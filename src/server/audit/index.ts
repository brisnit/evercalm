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
  // structure
  DEPARTMENT_CREATED: 'department.created',
  JOB_ROLE_CREATED: 'job_role.created',
  STATION_CREATED: 'station.created',
  VALUE_CREATED: 'organization_value.created',
  VALUE_UPDATED: 'organization_value.updated',
  // invitations
  INVITATION_SENT: 'invitation.sent',
  INVITATION_RESENT: 'invitation.resent',
  INVITATION_REVOKED: 'invitation.revoked',
  INVITATION_ACCEPTED: 'invitation.accepted',
  // people
  EMPLOYMENT_CREATED: 'employment.created',
  EMPLOYMENT_STATUS_CHANGED: 'employment.status_changed',
  EMPLOYMENT_TITLE_CHANGED: 'employment.title_changed',
  EMPLOYMENT_MANAGER_CHANGED: 'employment.manager_changed',
  EMPLOYMENT_LOCATION_ADDED: 'employment.location_added',
  EMPLOYMENT_LOCATION_REMOVED: 'employment.location_removed',
  EMPLOYMENT_SUSPENDED: 'employment.suspended',
  EMPLOYMENT_REACTIVATED: 'employment.reactivated',
  CREDENTIAL_RECORDED: 'credential.recorded',
  CREDENTIAL_REMOVED: 'credential.removed',
  // separation - the highest-consequence workflow in the product
  SEPARATION_REQUESTED: 'separation.requested',
  SEPARATION_APPROVED: 'separation.approved',
  SEPARATION_COMPLETED: 'separation.completed',
  SEPARATION_CANCELLED: 'separation.cancelled',
  // onboarding
  ONBOARDING_TEMPLATE_CREATED: 'onboarding_template.created',
  ONBOARDING_TEMPLATE_UPDATED: 'onboarding_template.updated',
  ONBOARDING_TEMPLATE_PUBLISHED: 'onboarding_template.published',
  ONBOARDING_TEMPLATE_DRAFTED: 'onboarding_template.new_draft',
  ONBOARDING_TEMPLATE_DUPLICATED: 'onboarding_template.duplicated',
  ONBOARDING_TEMPLATE_ARCHIVED: 'onboarding_template.archived',
  ONBOARDING_TEMPLATE_RESTORED: 'onboarding_template.restored',
  ONBOARDING_TEMPLATE_TARGETING_CHANGED: 'onboarding_template.targeting_changed',
  EMPLOYEES_IMPORTED: 'people.imported',
  ONBOARDING_ASSIGNED: 'onboarding.assigned',
  ONBOARDING_STEP_COMPLETED: 'onboarding_step.completed',
  ONBOARDING_STEP_VERIFIED: 'onboarding_step.verified',
  ONBOARDING_STEP_BLOCKED: 'onboarding_step.blocked',
  ONBOARDING_COMPLETED: 'onboarding.completed',
  // communication
  ANNOUNCEMENT_CREATED: 'announcement.created',
  ANNOUNCEMENT_UPDATED: 'announcement.updated',
  ANNOUNCEMENT_REVISED: 'announcement.revised',
  ANNOUNCEMENT_PUBLISHED: 'announcement.published',
  ANNOUNCEMENT_SCHEDULED: 'announcement.scheduled',
  ANNOUNCEMENT_SCHEDULE_CANCELLED: 'announcement.schedule_cancelled',
  /** The worker could not publish a schedule and returned it to draft. */
  ANNOUNCEMENT_SCHEDULE_FAILED: 'announcement.schedule_failed',
  ANNOUNCEMENT_EXPIRED: 'announcement.expired',
  ANNOUNCEMENT_ARCHIVED: 'announcement.archived',
  ANNOUNCEMENT_DUPLICATED: 'announcement.duplicated',
  ANNOUNCEMENT_RECIPIENTS_SYNCED: 'announcement.recipients_synced',
  ANNOUNCEMENT_REMINDER_SENT: 'announcement.reminder_sent',
  ANNOUNCEMENT_ACKNOWLEDGED: 'announcement.acknowledged',
  /** Emergency distribution is separated so it is trivial to audit for. */
  ANNOUNCEMENT_EMERGENCY_PUBLISHED: 'announcement.emergency_published',
  NOTIFICATION_PREFERENCES_CHANGED: 'notification_preferences.changed',
  EVENT_CREATED: 'event.created',
  EVENT_UPDATED: 'event.updated',
  EVENT_ARCHIVED: 'event.archived',
  // scheduling
  AVAILABILITY_UPDATED: 'availability.updated',
  TIME_OFF_REQUESTED: 'time_off.requested',
  TIME_OFF_APPROVED: 'time_off.approved',
  TIME_OFF_DENIED: 'time_off.denied',
  TIME_OFF_CANCELLED: 'time_off.cancelled',
  SHIFT_TEMPLATE_CREATED: 'shift_template.created',
  SHIFT_TEMPLATE_UPDATED: 'shift_template.updated',
  SHIFT_TEMPLATE_ARCHIVED: 'shift_template.archived',
  SHIFT_TEMPLATE_APPLIED: 'shift_template.applied',
  SCHEDULE_CREATED: 'schedule.created',
  SCHEDULE_PUBLISHED: 'schedule.published',
  SHIFT_CREATED: 'shift.created',
  SHIFT_UPDATED: 'shift.updated',
  SHIFT_ASSIGNED: 'shift.assigned',
  SHIFT_UNASSIGNED: 'shift.unassigned',
  SHIFT_OPENED: 'shift.opened',
  SHIFT_CANCELLED: 'shift.cancelled',
  SHIFT_DELETED: 'shift.deleted',
  OPEN_SHIFT_CLAIMED: 'open_shift.claimed',
  OPEN_SHIFT_CLAIM_WITHDRAWN: 'open_shift.claim_withdrawn',
  OPEN_SHIFT_CLAIM_APPROVED: 'open_shift.claim_approved',
  OPEN_SHIFT_CLAIM_DECLINED: 'open_shift.claim_declined',
  SWAP_REQUESTED: 'shift_swap.requested',
  SWAP_ACCEPTED: 'shift_swap.accepted',
  SWAP_DECLINED: 'shift_swap.declined',
  SWAP_CANCELLED: 'shift_swap.cancelled',
  SWAP_APPROVED: 'shift_swap.approved',
  SWAP_DENIED: 'shift_swap.denied',
  SWAP_EXPIRED: 'shift_swap.expired',
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
