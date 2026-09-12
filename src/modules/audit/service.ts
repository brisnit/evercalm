import { and, desc, eq } from 'drizzle-orm'
import { auditEvents } from '@/server/db/schema'
import type { Tx } from '@/server/db'
import { authorize } from '@/server/authz/can'
import type { Actor } from '@/server/authz/actor'

export interface AuditEntry {
  id: string
  action: string
  summary: string
  actorLabel: string | null
  actorType: string
  subjectType: string | null
  createdAt: Date
}

/**
 * Read the organization's audit history.
 *
 * Requires org.view_audit, which only Owner and HR Administrator hold. The
 * query is additionally constrained by RLS, so it cannot return another
 * tenant's events even if this check were removed.
 */
export async function listAuditEvents(tx: Tx, actor: Actor, limit = 100): Promise<AuditEntry[]> {
  authorize(actor, 'org.view_audit')

  return tx
    .select({
      id: auditEvents.id,
      action: auditEvents.action,
      summary: auditEvents.summary,
      actorLabel: auditEvents.actorLabel,
      actorType: auditEvents.actorType,
      subjectType: auditEvents.subjectType,
      createdAt: auditEvents.createdAt,
    })
    .from(auditEvents)
    .where(eq(auditEvents.organizationId, actor.organizationId))
    .orderBy(desc(auditEvents.createdAt))
    .limit(Math.min(limit, 200))
}

/** Count of events, for the empty-state decision. */
export async function countAuditEvents(tx: Tx, actor: Actor, action: string): Promise<number> {
  authorize(actor, 'org.view_audit')
  const rows = await tx
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .where(
      and(eq(auditEvents.organizationId, actor.organizationId), eq(auditEvents.action, action)),
    )
  return rows.length
}
