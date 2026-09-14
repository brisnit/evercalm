import type { Tx } from '@/server/db'
import { enqueue, type EnqueueInput } from '@/modules/notifications/service'

/*
 * SCHEDULE NOTIFICATIONS.
 *
 * Category `schedule`, which people can switch off per channel and which
 * respects quiet hours. A schedule change is important but is not a safety
 * notice: under the delivery policy (docs/permissions.md) nothing here
 * overrides a preference or wakes anybody. The change is always visible in the
 * app whether or not a notification was delivered.
 *
 * Queued for in-app and email together. The idempotency key includes
 * `purpose`, so each publication version, decision, or request produces one
 * notification per person per channel however often the action is retried.
 */

export interface ScheduleNotice {
  employmentId: string
  subjectType: 'schedule' | 'shift' | 'time_off' | 'shift_swap' | 'open_shift_claim'
  subjectId: string
  title: string
  preview: string
  href: string
  purpose: string
}

export async function notifySchedulePeople(
  tx: Tx,
  organizationId: string,
  notices: readonly ScheduleNotice[],
  now = new Date(),
): Promise<number> {
  if (notices.length === 0) return 0
  const base = notices.map((n): Omit<EnqueueInput, 'channel'> => ({
    employmentId: n.employmentId,
    category: 'schedule',
    subjectType: n.subjectType,
    subjectId: n.subjectId,
    title: n.title.slice(0, 140),
    preview: n.preview.slice(0, 200),
    href: n.href,
    purpose: n.purpose,
  }))
  const inApp = await enqueue(
    tx,
    organizationId,
    base.map((b) => ({ ...b, channel: 'in_app' as const })),
    now,
  )
  await enqueue(
    tx,
    organizationId,
    base.map((b) => ({ ...b, channel: 'email' as const })),
    now,
  )
  return inApp.created
}
