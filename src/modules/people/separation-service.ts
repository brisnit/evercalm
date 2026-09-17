import { and, desc, eq, inArray } from 'drizzle-orm'
import { employments, roleGrants, separations } from '@/server/db/schema'
import type { Tx } from '@/server/db'
import { newId } from '@/lib/ids'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { authorize, can } from '@/server/authz/can'
import type { Actor } from '@/server/authz/actor'
import { AUDIT_ACTIONS, recordAuditEvent } from '@/server/audit'

/**
 * SEPARATION.
 *
 * The highest-consequence workflow in EverCalm, so it is built as a record
 * with a lifecycle rather than a status flip:
 *
 *   draft -> pending_approval -> approved -> completed
 *                 |                  |
 *                 +------------------+-- cancelled (reversible until completed)
 *
 * Four properties this enforces, stated plainly:
 *
 *  1. **No automated decision.** Nothing in EverCalm creates or advances a
 *     separation. Every transition takes a named human Actor. There is no
 *     scheduled job, heuristic, or inference anywhere that touches this table.
 *  2. **Two-person rule.** The approver must hold organization-wide
 *     `people.separate` AND be a different person from the requester. Enforced
 *     in this service and again by a database CHECK constraint.
 *  3. **A stated reason is mandatory.** A separation cannot be filed without
 *     one, and the reason is preserved in the record and in audit history.
 *  4. **Reversible until the last step.** Access is revoked only by
 *     `completeSeparation`. Everything before that can be cancelled with the
 *     employment untouched.
 *
 * EverCalm provides NO jurisdiction-specific guidance here, and draws no legal
 * conclusion from the reason category. Those categories are neutral labels for
 * the customer's own record-keeping.
 */

/** Neutral labels. EverCalm attaches no legal meaning to any of them. */
export const SEPARATION_REASON_CATEGORIES = [
  'resignation',
  'end_of_season',
  'end_of_contract',
  'redundancy',
  'mutual_agreement',
  'dismissal',
  'other',
] as const
export type SeparationReasonCategory = (typeof SEPARATION_REASON_CATEGORIES)[number]

export interface SeparationRecord {
  id: string
  employmentId: string
  employeeName: string
  reasonCategory: string
  reason: string
  effectiveOn: string
  status: string
  requestedBy: string | null
  requestedAt: Date
  approvedBy: string | null
  approvedAt: Date | null
  completedAt: Date | null
}

async function loadSeparation(tx: Tx, actor: Actor, separationId: string) {
  const [row] = await tx
    .select()
    .from(separations)
    .where(
      and(eq(separations.organizationId, actor.organizationId), eq(separations.id, separationId)),
    )
    .limit(1)
  if (!row) throw new NotFoundError('Separation record not found')
  return row
}

/**
 * Begin offboarding. Creates a pending record; changes nothing about access.
 */
export async function requestSeparation(
  tx: Tx,
  actor: Actor,
  input: {
    employmentId: string
    reasonCategory: SeparationReasonCategory
    reason: string
    effectiveOn: string
  },
): Promise<string> {
  authorize(actor, 'people.separate')

  if (input.employmentId === actor.employmentId) {
    throw new ValidationError(
      {},
      'You cannot file your own separation. Ask an owner or HR administrator.',
    )
  }

  const reason = input.reason.trim()
  if (reason.length < 10) {
    throw new ValidationError(
      { reason: ['Record why this employment is ending, in at least 10 characters.'] },
      'A reason is required',
    )
  }

  const [person] = await tx
    .select({
      id: employments.id,
      displayName: employments.displayName,
      status: employments.status,
    })
    .from(employments)
    .where(
      and(
        eq(employments.organizationId, actor.organizationId),
        eq(employments.id, input.employmentId),
      ),
    )
    .limit(1)
  if (!person) throw new NotFoundError('Employee not found')
  if (person.status === 'separated') {
    throw new ValidationError({}, 'This employment has already ended.')
  }

  const open = await tx
    .select({ id: separations.id })
    .from(separations)
    .where(
      and(
        eq(separations.organizationId, actor.organizationId),
        eq(separations.employmentId, input.employmentId),
        eq(separations.status, 'pending_approval'),
      ),
    )
    .limit(1)
  if (open[0]) {
    throw new ValidationError(
      {},
      'There is already a separation awaiting approval for this person.',
    )
  }

  const separationId = newId()
  await tx.insert(separations).values({
    id: separationId,
    organizationId: actor.organizationId,
    employmentId: input.employmentId,
    reasonCategory: input.reasonCategory,
    reason,
    effectiveOn: input.effectiveOn,
    status: 'pending_approval',
    requestedByEmploymentId: actor.employmentId,
  })

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.SEPARATION_REQUESTED,
    summary: `Requested separation for ${person.displayName}, effective ${input.effectiveOn}`,
    subjectType: 'employment',
    subjectId: input.employmentId,
    metadata: { separationId, reasonCategory: input.reasonCategory },
  })

  return separationId
}

/**
 * The second human. Must hold organization-wide `people.separate` and must not
 * be the requester.
 */
export async function approveSeparation(tx: Tx, actor: Actor, separationId: string): Promise<void> {
  // Deliberately the organization-wide form: approving somebody's separation
  // is not a location-scoped act.
  if (!can(actor, 'people.separate')) throw new ForbiddenError('people.separate')

  const record = await loadSeparation(tx, actor, separationId)
  if (record.status !== 'pending_approval') {
    throw new ValidationError({}, 'This separation is not awaiting approval.')
  }
  if (record.requestedByEmploymentId === actor.employmentId) {
    throw new ValidationError(
      {},
      'A separation must be approved by someone other than the person who requested it.',
    )
  }

  await tx
    .update(separations)
    .set({
      status: 'approved',
      approvedByEmploymentId: actor.employmentId,
      approvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(eq(separations.organizationId, actor.organizationId), eq(separations.id, separationId)),
    )

  const [person] = await tx
    .select({ displayName: employments.displayName })
    .from(employments)
    .where(
      and(
        eq(employments.organizationId, actor.organizationId),
        eq(employments.id, record.employmentId),
      ),
    )
    .limit(1)

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.SEPARATION_APPROVED,
    summary: `Approved the separation for ${person?.displayName ?? 'an employee'}`,
    subjectType: 'employment',
    subjectId: record.employmentId,
    metadata: { separationId, requestedBy: record.requestedByEmploymentId },
  })
}

/**
 * The only irreversible step: ends the employment and revokes every role grant.
 * The employment record itself is retained - history is not deleted.
 */
export async function completeSeparation(
  tx: Tx,
  actor: Actor,
  separationId: string,
): Promise<void> {
  if (!can(actor, 'people.separate')) throw new ForbiddenError('people.separate')

  const record = await loadSeparation(tx, actor, separationId)
  if (record.status !== 'approved') {
    throw new ValidationError({}, 'A separation must be approved before it can be completed.')
  }

  const [person] = await tx
    .select({ displayName: employments.displayName })
    .from(employments)
    .where(
      and(
        eq(employments.organizationId, actor.organizationId),
        eq(employments.id, record.employmentId),
      ),
    )
    .limit(1)

  await tx
    .update(employments)
    .set({
      status: 'separated',
      separatedOn: record.effectiveOn,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(employments.organizationId, actor.organizationId),
        eq(employments.id, record.employmentId),
      ),
    )

  // Access revocation. resolveActor() already refuses a separated employment,
  // so this is defence in depth rather than the only gate.
  await tx
    .update(roleGrants)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(roleGrants.organizationId, actor.organizationId),
        eq(roleGrants.employmentId, record.employmentId),
      ),
    )

  await tx
    .update(separations)
    .set({ status: 'completed', completedAt: new Date(), updatedAt: new Date() })
    .where(
      and(eq(separations.organizationId, actor.organizationId), eq(separations.id, separationId)),
    )

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.SEPARATION_COMPLETED,
    summary: `Completed the separation for ${person?.displayName ?? 'an employee'}; access revoked`,
    subjectType: 'employment',
    subjectId: record.employmentId,
    metadata: {
      separationId,
      requestedBy: record.requestedByEmploymentId,
      approvedBy: record.approvedByEmploymentId,
      effectiveOn: record.effectiveOn,
    },
  })
}

/** Reverses a separation at any point before completion. */
export async function cancelSeparation(
  tx: Tx,
  actor: Actor,
  separationId: string,
  reason: string,
): Promise<void> {
  if (!can(actor, 'people.separate')) throw new ForbiddenError('people.separate')

  const record = await loadSeparation(tx, actor, separationId)
  if (record.status === 'completed') {
    throw new ValidationError(
      {},
      'This separation has already been completed and cannot be cancelled.',
    )
  }
  if (record.status === 'cancelled') return

  await tx
    .update(separations)
    .set({
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelledByEmploymentId: actor.employmentId,
      updatedAt: new Date(),
    })
    .where(
      and(eq(separations.organizationId, actor.organizationId), eq(separations.id, separationId)),
    )

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.SEPARATION_CANCELLED,
    summary: `Cancelled a separation before it took effect`,
    subjectType: 'employment',
    subjectId: record.employmentId,
    metadata: { separationId, reason: reason.trim() },
  })
}

export async function listSeparations(tx: Tx, actor: Actor): Promise<SeparationRecord[]> {
  authorize(actor, 'people.separate')

  const requester = employments
  const rows = await tx
    .select({
      id: separations.id,
      employmentId: separations.employmentId,
      employeeName: employments.displayName,
      reasonCategory: separations.reasonCategory,
      reason: separations.reason,
      effectiveOn: separations.effectiveOn,
      status: separations.status,
      requestedByEmploymentId: separations.requestedByEmploymentId,
      requestedAt: separations.requestedAt,
      approvedByEmploymentId: separations.approvedByEmploymentId,
      approvedAt: separations.approvedAt,
      completedAt: separations.completedAt,
    })
    .from(separations)
    .innerJoin(
      requester,
      and(
        eq(employments.id, separations.employmentId),
        eq(employments.organizationId, separations.organizationId),
      ),
    )
    .where(eq(separations.organizationId, actor.organizationId))
    .orderBy(desc(separations.requestedAt))

  // Resolve the two named humans separately: joining the same table three
  // times obscures more than it saves.
  if (rows.length === 0) return []
  const namedIds = [
    ...new Set(rows.flatMap((r) => [r.requestedByEmploymentId, r.approvedByEmploymentId])),
  ].filter((id): id is string => !!id)
  const people = await tx
    .select({ id: employments.id, displayName: employments.displayName })
    .from(employments)
    .where(
      and(eq(employments.organizationId, actor.organizationId), inArray(employments.id, namedIds)),
    )
  const nameOf = new Map(people.map((p) => [p.id, p.displayName]))

  return rows.map((r) => ({
    id: r.id,
    employmentId: r.employmentId,
    employeeName: r.employeeName,
    reasonCategory: r.reasonCategory,
    reason: r.reason,
    effectiveOn: r.effectiveOn,
    status: r.status,
    requestedBy: nameOf.get(r.requestedByEmploymentId) ?? null,
    requestedAt: r.requestedAt,
    approvedBy: r.approvedByEmploymentId ? (nameOf.get(r.approvedByEmploymentId) ?? null) : null,
    approvedAt: r.approvedAt,
    completedAt: r.completedAt,
  }))
}
