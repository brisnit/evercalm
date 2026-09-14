import type { Tx } from '@/server/db'
import { enqueue, type EnqueueInput } from '@/modules/notifications/service'

/*
 * TRAINING NOTIFICATIONS.
 *
 * Category `training`, which people can switch off per channel and which
 * respects quiet hours. Being given a course is worth knowing about, but it
 * is not urgent: nothing here overrides a preference or wakes anybody, and
 * everything is visible under Training whether or not a notification was
 * delivered.
 *
 * In-app and email together. The idempotency key includes `purpose`, so a
 * retried assignment or a double-clicked sign-off produces one notification
 * per person per channel.
 */

export interface TrainingNotice {
  employmentId: string
  subjectType: 'training_assignment' | 'training_signoff'
  subjectId: string
  title: string
  preview: string
  href: string
  purpose: string
}

export async function notifyTrainingPeople(
  tx: Tx,
  organizationId: string,
  notices: readonly TrainingNotice[],
  now = new Date(),
): Promise<number> {
  if (notices.length === 0) return 0
  const base = notices.map((n): Omit<EnqueueInput, 'channel'> => ({
    employmentId: n.employmentId,
    category: 'training',
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
