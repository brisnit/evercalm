import type { Tx } from '@/server/db'
import { enqueue, type EnqueueInput } from '@/modules/notifications/service'

/*
 * SHIFT OPERATIONS NOTIFICATIONS.
 *
 * Category `operations`. Deliberately few, and in-app only: a person on shift
 * is looking at the workspace, not their email, and the workspace already
 * shows every state. Notifications cover the moments someone would otherwise
 * miss:
 *
 *   a pre-shift reminder when there is work to do before the shift starts
 *   a manager sent a task back
 *   a manager gave somebody a task
 *   a handoff someone left was resolved
 *
 * Nothing here overrides a preference or quiet hours. The idempotency key
 * includes `purpose`, so a retried action produces one notification.
 */

export interface OperationsNotice {
  employmentId: string
  subjectType: 'shift' | 'ops_task' | 'handoff'
  subjectId: string
  title: string
  preview: string
  href: string
  purpose: string
}

export async function notifyOperationsPeople(
  tx: Tx,
  organizationId: string,
  notices: readonly OperationsNotice[],
  now = new Date(),
): Promise<number> {
  if (notices.length === 0) return 0
  const inputs = notices.map((n): EnqueueInput => ({
    employmentId: n.employmentId,
    category: 'operations',
    channel: 'in_app',
    subjectType: n.subjectType,
    subjectId: n.subjectId,
    title: n.title.slice(0, 140),
    preview: n.preview.slice(0, 200),
    href: n.href,
    purpose: n.purpose,
  }))
  const outcome = await enqueue(tx, organizationId, inputs, now)
  return outcome.created
}
