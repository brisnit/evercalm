import { and, count, desc, eq, gt, isNotNull, notLike, sql } from 'drizzle-orm'
import type { Tx } from '@/server/db'
import { announcements, notifications } from '@/server/db/schema'
import type { Actor } from '@/server/authz'
import { authorize, can } from '@/server/authz/can'
import { AUDIT_ACTIONS, recordAuditEvent } from '@/server/audit'
import { workerState, type WorkerState } from '@/server/readiness'

/*
 * SYSTEM STATUS FOR ONE ORGANIZATION.
 *
 * What an owner can act on, and nothing about infrastructure: whether
 * background work is running, which of their notifications could not be
 * delivered and why (in words safe for an administrator), and scheduled
 * announcements that failed to publish. Other organizations' problems are
 * invisible: every query is tenant-scoped, and the worker summary comes from
 * a function that reads the tenant from the transaction.
 */

const DAY = 86_400_000

/** Failures a retry cannot fix, because nothing about them will change on their own. */
const PERMANENT_REASONS = ['No email address%', 'The % channel is not available%']

export interface SystemStatus {
  worker: { state: WorkerState; lastFinishedAt: Date | null; errors24h: number }
  deliveries: {
    sent: number
    pending: number
    failed: number
    suppressed: number
    retryable: number
    failures: { channel: string; reason: string; count: number; lastFailedAt: Date | null }[]
  }
  publishing: { failed: number; lastFailedAt: Date | null }
  canRetry: boolean
}

export async function getSystemStatus(
  tx: Tx,
  actor: Actor,
  now = new Date(),
): Promise<SystemStatus> {
  authorize(actor, 'org.view')
  const since = new Date(now.getTime() - 7 * DAY)
  const org = actor.organizationId

  const [workerRows, statusRows, failureRows, retryable, publishRows] = await Promise.all([
    tx.execute<{ last_finished_at: string | null; errors_24h: number }>(
      sql`select * from evercalm_tenant_worker_status()`,
    ),
    tx
      .select({ status: notifications.status, n: count() })
      .from(notifications)
      .where(and(eq(notifications.organizationId, org), gt(notifications.createdAt, since)))
      .groupBy(notifications.status),
    tx
      .select({
        channel: notifications.channel,
        reason: sql<string>`coalesce(${notifications.failureReason}, 'Unknown')`,
        n: count(),
        last: sql<Date | null>`max(${notifications.failedAt})`,
      })
      .from(notifications)
      .where(
        and(
          eq(notifications.organizationId, org),
          eq(notifications.status, 'failed'),
          gt(notifications.failedAt, since),
        ),
      )
      .groupBy(notifications.channel, sql`coalesce(${notifications.failureReason}, 'Unknown')`)
      .orderBy(desc(count())),
    tx.select({ n: count() }).from(notifications).where(retryableWhere(org, since)),
    tx
      .select({ n: count(), last: sql<Date | null>`max(${announcements.publishFailedAt})` })
      .from(announcements)
      .where(
        and(
          eq(announcements.organizationId, org),
          isNotNull(announcements.publishFailedAt),
          gt(announcements.publishFailedAt, new Date(now.getTime() - 30 * DAY)),
        ),
      ),
  ])

  const worker = workerRows.rows[0]
  const lastFinishedAt = worker?.last_finished_at ? new Date(worker.last_finished_at) : null
  const byStatus = new Map(statusRows.map((r) => [r.status, r.n]))
  return {
    worker: {
      state: workerState(lastFinishedAt, now),
      lastFinishedAt,
      errors24h: worker?.errors_24h ?? 0,
    },
    deliveries: {
      sent: byStatus.get('sent') ?? 0,
      pending: byStatus.get('pending') ?? 0,
      failed: byStatus.get('failed') ?? 0,
      suppressed: byStatus.get('suppressed') ?? 0,
      retryable: retryable[0]?.n ?? 0,
      failures: failureRows.map((r) => ({
        channel: r.channel,
        reason: r.reason,
        count: r.n,
        lastFailedAt: r.last ? new Date(r.last) : null,
      })),
    },
    publishing: {
      failed: publishRows[0]?.n ?? 0,
      lastFailedAt: publishRows[0]?.last ? new Date(publishRows[0].last) : null,
    },
    canRetry: can(actor, 'notification.administer'),
  }
}

function retryableWhere(organizationId: string, since: Date) {
  return and(
    eq(notifications.organizationId, organizationId),
    eq(notifications.status, 'failed'),
    gt(notifications.failedAt, since),
    ...PERMANENT_REASONS.map((pattern) =>
      notLike(sql`coalesce(${notifications.failureReason}, '')`, pattern),
    ),
  )
}

/**
 * Queue the last week's retryable failures to be tried again. Each keeps its
 * idempotency key, so a retry can never create a second notification.
 */
export async function retryFailedNotifications(
  tx: Tx,
  actor: Actor,
  now = new Date(),
): Promise<number> {
  authorize(actor, 'notification.administer')
  const rows = await tx
    .update(notifications)
    .set({
      status: 'pending',
      attempts: 0,
      failedAt: null,
      failureReason: null,
      scheduledFor: now,
      lockedUntil: null,
      claimToken: null,
    })
    .where(retryableWhere(actor.organizationId, new Date(now.getTime() - 7 * DAY)))
    .returning({ id: notifications.id })
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.NOTIFICATIONS_RETRIED,
    summary: `Queued ${rows.length} failed ${rows.length === 1 ? 'notification' : 'notifications'} to try again`,
    subjectType: 'organization',
    subjectId: actor.organizationId,
    metadata: { count: rows.length },
  })
  return rows.length
}
