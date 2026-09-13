import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Tx } from '@/server/db/types'
import type { Actor } from '@/server/authz/actor'
import { accessibleLocationIds, canAtAnyLocation } from '@/server/authz/can'
import { ForbiddenError } from '@/lib/errors'
import { AUDIT_ACTIONS, recordAuditEvent, recordSystemAuditEvent } from '@/server/audit'
import { departments, employments, jobRoles, locations } from '@/server/db/schema'
import { enqueue, type EnqueueInput } from '@/modules/notifications/service'
import { preview as buildPreview } from './content'
import { announcementRecipients, announcements } from './schema'
import { requireAnnouncement } from './service'
import { deliveryPolicy } from './delivery-policy'
import { announcementCategories, announcementRevisions } from './schema'

/**
 * READ AND ACKNOWLEDGEMENT REPORTING.
 *
 * The scoping rule, which is the part that matters: a manager sees the
 * recipients they are responsible for and nobody else. `visibleLocationIds`
 * returns null for an org-wide grant and a list otherwise, and every query
 * here filters on `location_id_at_publish` - the location the person held WHEN
 * THEY WERE TARGETED, not where they are today. Using their current location
 * would let a transfer quietly reveal a row to a manager who never had it, or
 * hide one that has always been theirs.
 *
 * A location-scoped manager therefore sees a partial report of an
 * organization-wide announcement, and the screen says so rather than
 * presenting their slice as the whole picture.
 */

export interface ReceiptRow {
  employmentId: string
  displayName: string
  locationName: string | null
  departmentName: string | null
  jobRoleName: string | null
  deliveryStatus: string
  deliveryFailureReason: string | null
  firstViewedAt: Date | null
  acknowledgedAt: Date | null
  needsReacknowledgement: boolean
  reminderCount: number
  lastRemindedAt: Date | null
}

export interface ReceiptTotals {
  targeted: number
  delivered: number
  failed: number
  viewed: number
  unread: number
  acknowledged: number
  outstanding: number
  overdue: number
}

export interface ReceiptBreakdown {
  label: string
  targeted: number
  viewed: number
  acknowledged: number
}

export interface ReceiptReport {
  totals: ReceiptTotals
  rows: ReceiptRow[]
  byLocation: ReceiptBreakdown[]
  byDepartment: ReceiptBreakdown[]
  byJobRole: ReceiptBreakdown[]
  /** True when the viewer is only seeing part of the audience. */
  partialView: boolean
  requiresAcknowledgement: boolean
  acknowledgementDueAt: Date | null
}

/** Locations whose receipts this actor may see. `null` means all of them. */
export function visibleLocationIds(actor: Actor): string[] | null {
  return accessibleLocationIds(actor, 'announcement.view_receipts')
}

export async function receiptReport(
  tx: Tx,
  actor: Actor,
  announcementId: string,
): Promise<ReceiptReport> {
  // Somewhere, then narrowed below - a location manager must get their own
  // slice of the report rather than a refusal. See docs/permissions.md.
  if (!canAtAnyLocation(actor, 'announcement.view_receipts')) {
    throw new ForbiddenError('announcement.view_receipts')
  }
  const announcement = await requireAnnouncement(tx, actor, announcementId)
  const allowed = visibleLocationIds(actor)
  if (allowed !== null && allowed.length === 0) {
    throw new ForbiddenError('announcement.view_receipts')
  }

  const rows = await tx
    .select({
      employmentId: announcementRecipients.employmentId,
      displayName: employments.displayName,
      locationName: locations.name,
      departmentName: departments.name,
      jobRoleName: jobRoles.name,
      deliveryStatus: announcementRecipients.deliveryStatus,
      deliveryFailureReason: announcementRecipients.deliveryFailureReason,
      firstViewedAt: announcementRecipients.firstViewedAt,
      acknowledgedAt: announcementRecipients.acknowledgedAt,
      reacknowledgementRequestedAt: announcementRecipients.reacknowledgementRequestedAt,
      reminderCount: announcementRecipients.reminderCount,
      lastRemindedAt: announcementRecipients.lastRemindedAt,
    })
    .from(announcementRecipients)
    .innerJoin(
      employments,
      and(
        eq(employments.organizationId, announcementRecipients.organizationId),
        eq(employments.id, announcementRecipients.employmentId),
      ),
    )
    .leftJoin(
      locations,
      and(
        eq(locations.organizationId, announcementRecipients.organizationId),
        eq(locations.id, announcementRecipients.locationIdAtPublish),
      ),
    )
    .leftJoin(
      departments,
      and(
        eq(departments.organizationId, announcementRecipients.organizationId),
        eq(departments.id, announcementRecipients.departmentIdAtPublish),
      ),
    )
    .leftJoin(
      jobRoles,
      and(
        eq(jobRoles.organizationId, announcementRecipients.organizationId),
        eq(jobRoles.id, announcementRecipients.jobRoleIdAtPublish),
      ),
    )
    .where(
      and(
        eq(announcementRecipients.organizationId, actor.organizationId),
        eq(announcementRecipients.announcementId, announcementId),
        allowed === null ? undefined : inArray(announcementRecipients.locationIdAtPublish, allowed),
      ),
    )
    .orderBy(asc(employments.displayName))

  const now = Date.now()
  const due = announcement.acknowledgementDueAt?.getTime() ?? null

  const receipts: ReceiptRow[] = rows.map((r) => ({
    employmentId: r.employmentId,
    displayName: r.displayName,
    locationName: r.locationName,
    departmentName: r.departmentName,
    jobRoleName: r.jobRoleName,
    deliveryStatus: r.deliveryStatus,
    deliveryFailureReason: r.deliveryFailureReason,
    firstViewedAt: r.firstViewedAt,
    acknowledgedAt: r.acknowledgedAt,
    needsReacknowledgement: r.acknowledgedAt !== null && r.reacknowledgementRequestedAt !== null,
    reminderCount: r.reminderCount,
    lastRemindedAt: r.lastRemindedAt,
  }))

  const outstanding = receipts.filter(
    (r) =>
      announcement.requiresAcknowledgement &&
      (r.acknowledgedAt === null || r.needsReacknowledgement),
  )

  const totals: ReceiptTotals = {
    targeted: receipts.length,
    delivered: receipts.filter((r) => r.deliveryStatus === 'sent').length,
    failed: receipts.filter((r) => r.deliveryStatus === 'failed').length,
    viewed: receipts.filter((r) => r.firstViewedAt !== null).length,
    unread: receipts.filter((r) => r.firstViewedAt === null).length,
    acknowledged: receipts.filter((r) => r.acknowledgedAt !== null && !r.needsReacknowledgement)
      .length,
    outstanding: outstanding.length,
    overdue: due !== null && due < now ? outstanding.length : 0,
  }

  return {
    totals,
    rows: receipts,
    byLocation: groupBy(receipts, (r) => r.locationName ?? 'No location'),
    byDepartment: groupBy(receipts, (r) => r.departmentName ?? 'No department'),
    byJobRole: groupBy(receipts, (r) => r.jobRoleName ?? 'No job role'),
    partialView: allowed !== null,
    requiresAcknowledgement: announcement.requiresAcknowledgement,
    acknowledgementDueAt: announcement.acknowledgementDueAt,
  }
}

function groupBy(rows: ReceiptRow[], key: (row: ReceiptRow) => string): ReceiptBreakdown[] {
  const map = new Map<string, ReceiptBreakdown>()
  for (const row of rows) {
    const label = key(row)
    const entry = map.get(label) ?? { label, targeted: 0, viewed: 0, acknowledged: 0 }
    entry.targeted += 1
    if (row.firstViewedAt !== null) entry.viewed += 1
    if (row.acknowledgedAt !== null && !row.needsReacknowledgement) entry.acknowledged += 1
    map.set(label, entry)
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * Nudge everybody still outstanding.
 *
 * A reminder is a separate notification, not a re-send: its idempotency key
 * carries the reminder number, so pressing the button twice in a minute
 * produces one nudge, while a genuine second reminder tomorrow produces
 * another. Only people the actor may see are reminded, for the same reason
 * they only appear in the report.
 */
export interface ReminderOutcome {
  reminded: number
  queued: number
  suppressed: number
  delayed: number
}

export async function sendReminders(
  tx: Tx,
  actor: Actor,
  announcementId: string,
  now = new Date(),
): Promise<ReminderOutcome> {
  if (!canAtAnyLocation(actor, 'announcement.send_reminder')) {
    throw new ForbiddenError('announcement.send_reminder')
  }
  const announcement = await requireAnnouncement(tx, actor, announcementId)
  const allowed = visibleLocationIds(actor)
  if (allowed !== null && allowed.length === 0) {
    throw new ForbiddenError('announcement.send_reminder')
  }

  const outstanding = await tx
    .select({
      id: announcementRecipients.id,
      employmentId: announcementRecipients.employmentId,
      reminderCount: announcementRecipients.reminderCount,
    })
    .from(announcementRecipients)
    .where(
      and(
        eq(announcementRecipients.organizationId, actor.organizationId),
        eq(announcementRecipients.announcementId, announcementId),
        allowed === null ? undefined : inArray(announcementRecipients.locationIdAtPublish, allowed),
        announcement.requiresAcknowledgement
          ? sql`(${announcementRecipients.acknowledgedAt} is null or ${announcementRecipients.reacknowledgementRequestedAt} is not null)`
          : isNull(announcementRecipients.firstViewedAt),
      ),
    )

  if (outstanding.length === 0) {
    return { reminded: 0, queued: 0, suppressed: 0, delayed: 0 }
  }

  const [category] = await tx
    .select({
      key: announcementCategories.key,
      overridesPreferences: announcementCategories.overridesPreferences,
    })
    .from(announcementCategories)
    .where(
      and(
        eq(announcementCategories.organizationId, actor.organizationId),
        eq(announcementCategories.id, announcement.categoryId),
      ),
    )
    .limit(1)

  const policy = deliveryPolicy(announcement, {
    overridesPreferences: category?.overridesPreferences ?? false,
  })

  const inputs = outstanding.map((row): Omit<EnqueueInput, 'channel'> => ({
    employmentId: row.employmentId,
    category: category?.key ?? 'general',
    subjectType: 'announcement',
    subjectId: announcementId,
    title: announcement.requiresAcknowledgement
      ? `Still needs your acknowledgement: ${announcement.title}`
      : `Reminder: ${announcement.title}`,
    preview: buildPreview(announcement.body),
    href: `/my/inbox/${announcementId}`,
    overridesPreferences: policy.overridesPreferences,
    overridesQuietHours: policy.overridesQuietHours,
    // The reminder number is part of the key, so today's nudge and
    // tomorrow's are different messages while a double click is not.
    purpose: `reminder-${row.reminderCount + 1}`,
  }))

  const queue = await enqueue(
    tx,
    actor.organizationId,
    inputs.map((i) => ({ ...i, channel: 'in_app' as const })),
    now,
  )
  await enqueue(
    tx,
    actor.organizationId,
    inputs.map((i) => ({ ...i, channel: 'email' as const })),
    now,
  )

  await tx
    .update(announcementRecipients)
    .set({
      reminderCount: sql`${announcementRecipients.reminderCount} + 1`,
      lastRemindedAt: now,
    })
    .where(
      and(
        eq(announcementRecipients.organizationId, actor.organizationId),
        inArray(
          announcementRecipients.id,
          outstanding.map((r) => r.id),
        ),
      ),
    )

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.ANNOUNCEMENT_REMINDER_SENT,
    summary: `Reminded ${outstanding.length} ${
      outstanding.length === 1 ? 'person' : 'people'
    } about "${announcement.title}"`,
    subjectType: 'announcement',
    subjectId: announcementId,
    metadata: { reminded: outstanding.length },
  })

  return {
    reminded: outstanding.length,
    queued: queue.created,
    suppressed: queue.suppressed,
    delayed: queue.delayed,
  }
}

/*
 * AUTOMATIC REMINDERS, run by the worker.
 *
 * Two per person, per announcement that needs acknowledgement and has a due
 * date:
 *
 *   due soon   once the due date is within 24 hours
 *   overdue    once it has passed
 *
 * Each is CLAIMED by a conditional update on its own stamp column
 * (`... WHERE due_soon_reminded_at IS NULL`), and only the rows that update
 * returns are notified. Two workers racing therefore cannot both remind the
 * same person - under READ COMMITTED the second re-evaluates the condition
 * after the first commits and matches nothing - and a restarted worker sees
 * the stamp and skips. The notification's idempotency key backs that up.
 *
 * AFTER DOWNTIME a worker that first runs past the due date sends only the
 * overdue reminder and stamps both, rather than a "due soon" for something
 * already late.
 *
 * Reminders follow the same delivery policy as the announcement: a routine
 * overdue confirmation waits for quiet hours to end.
 */

export const DUE_SOON_WINDOW_MS = 24 * 60 * 60_000

export interface AutomaticReminderResult {
  announcements: number
  reminded: number
}

export async function processAutomaticReminders(
  tx: Tx,
  organizationId: string,
  now: Date,
): Promise<AutomaticReminderResult> {
  const horizon = new Date(now.getTime() + DUE_SOON_WINDOW_MS)
  const candidates = await tx
    .select({
      id: announcements.id,
      priority: announcements.priority,
      requiresAcknowledgement: announcements.requiresAcknowledgement,
      dueAt: announcements.acknowledgementDueAt,
      categoryKey: announcementCategories.key,
      overridesPreferences: announcementCategories.overridesPreferences,
      currentRevisionId: announcements.currentRevisionId,
    })
    .from(announcements)
    .innerJoin(
      announcementCategories,
      and(
        eq(announcementCategories.organizationId, announcements.organizationId),
        eq(announcementCategories.id, announcements.categoryId),
      ),
    )
    .where(
      and(
        eq(announcements.organizationId, organizationId),
        eq(announcements.status, 'published'),
        eq(announcements.requiresAcknowledgement, true),
        sql`${announcements.acknowledgementDueAt} is not null`,
        sql`${announcements.acknowledgementDueAt} <= ${horizon.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(announcements.id)

  const result: AutomaticReminderResult = { announcements: 0, reminded: 0 }

  for (const candidate of candidates) {
    // Hold the announcement row while its reminders are claimed. SKIP LOCKED:
    // if another worker holds it, that worker is doing this work right now.
    const [held] = await tx
      .select({ id: announcements.id })
      .from(announcements)
      .where(
        and(eq(announcements.organizationId, organizationId), eq(announcements.id, candidate.id)),
      )
      .for('update', { skipLocked: true })
    if (!held) continue

    const overdue = candidate.dueAt !== null && candidate.dueAt.getTime() <= now.getTime()
    const stamp = overdue
      ? announcementRecipients.overdueRemindedAt
      : announcementRecipients.dueSoonRemindedAt

    const claimed = await tx
      .update(announcementRecipients)
      .set({
        ...(overdue
          ? {
              overdueRemindedAt: now,
              dueSoonRemindedAt: sql`coalesce(${announcementRecipients.dueSoonRemindedAt}, ${now.toISOString()}::timestamptz)`,
            }
          : { dueSoonRemindedAt: now }),
        reminderCount: sql`${announcementRecipients.reminderCount} + 1`,
        lastRemindedAt: now,
      })
      .where(
        and(
          eq(announcementRecipients.organizationId, organizationId),
          eq(announcementRecipients.announcementId, candidate.id),
          isNull(stamp),
          sql`(${announcementRecipients.acknowledgedAt} is null or ${announcementRecipients.reacknowledgementRequestedAt} is not null)`,
        ),
      )
      .returning({ employmentId: announcementRecipients.employmentId })

    if (claimed.length === 0) continue

    const [revision] = await tx
      .select({
        title: announcementRevisions.title,
        body: announcementRevisions.body,
        revisionNumber: announcementRevisions.revisionNumber,
      })
      .from(announcementRevisions)
      .where(
        and(
          eq(announcementRevisions.organizationId, organizationId),
          eq(announcementRevisions.id, candidate.currentRevisionId ?? ''),
        ),
      )
      .limit(1)
    const title = revision?.title ?? 'An announcement'

    const policy = deliveryPolicy(candidate, candidate)
    const inputs = claimed.map((row): Omit<EnqueueInput, 'channel'> => ({
      employmentId: row.employmentId,
      category: candidate.categoryKey,
      subjectType: 'announcement',
      subjectId: candidate.id,
      title: overdue
        ? `Overdue: please confirm ${title}`
        : `Due within a day: please confirm ${title}`,
      preview: buildPreview(revision?.body ?? ''),
      href: `/my/inbox/${candidate.id}`,
      overridesPreferences: policy.overridesPreferences,
      overridesQuietHours: policy.overridesQuietHours,
      // The revision is part of the key. A material revision resets the
      // stamps of people asked to confirm again; without it their new reminder
      // would collide with the one they already had and be silently dropped.
      purpose: `${overdue ? 'auto-overdue' : 'auto-due-soon'}-r${revision?.revisionNumber ?? 1}`,
    }))
    await enqueue(
      tx,
      organizationId,
      inputs.map((i) => ({ ...i, channel: 'in_app' as const })),
      now,
    )
    await enqueue(
      tx,
      organizationId,
      inputs.map((i) => ({ ...i, channel: 'email' as const })),
      now,
    )

    await recordSystemAuditEvent(tx, organizationId, {
      action: AUDIT_ACTIONS.ANNOUNCEMENT_REMINDER_SENT,
      reason: 'Automatic reminder',
      summary: `Automatically reminded ${claimed.length} ${
        claimed.length === 1 ? 'person' : 'people'
      } that a confirmation is ${overdue ? 'overdue' : 'due within a day'}`,
      subjectType: 'announcement',
      subjectId: candidate.id,
      metadata: {
        automatic: true,
        kind: overdue ? 'overdue' : 'due_soon',
        reminded: claimed.length,
      },
    })

    result.announcements += 1
    result.reminded += claimed.length
  }

  return result
}
