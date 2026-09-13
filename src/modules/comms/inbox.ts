import { and, desc, eq, isNull, ne, or, sql } from 'drizzle-orm'
import type { Tx } from '@/server/db/types'
import type { Actor } from '@/server/authz/actor'
import { isSelf } from '@/server/authz/can'
import { ForbiddenError, NotFoundError } from '@/lib/errors'
import { AUDIT_ACTIONS, recordAuditEvent } from '@/server/audit'
import { employments } from '@/server/db/schema'
import {
  announcementCategories,
  announcementRecipients,
  announcementRevisions,
  announcements,
  type AnnouncementPriority,
} from './schema'

/**
 * THE EMPLOYEE INBOX.
 *
 * Reading is not acknowledgement, and the two are never inferred from each
 * other. Opening an announcement records a VIEW: `first_viewed_at` if it is
 * the first time, `last_viewed_at` and a counter every time. Acknowledgement
 * only ever happens through `acknowledge()`, which is reached from a button a
 * person deliberately presses.
 *
 * This distinction is the whole point of the feature. "They opened it" is not
 * a defensible answer to "did they agree to the allergen policy", and a system
 * that quietly conflates the two produces a record that looks like consent and
 * is not.
 *
 * ORDERING. What needs doing comes before what is merely new:
 *   1. acknowledgement outstanding, ordered by how soon it is due
 *   2. pinned priorities (urgent, emergency) that are still unread
 *   3. everything else, newest first
 * Priority raises position; it never removes anything, and it is always
 * accompanied by a text label so the order is explicable without colour.
 */

export type InboxFilter = 'all' | 'unread' | 'acknowledge' | 'archived'

export interface InboxItem {
  recipientId: string
  announcementId: string
  title: string
  preview: string
  priority: AnnouncementPriority
  categoryKey: string
  categoryName: string
  publishedAt: Date | null
  expiresAt: Date | null
  requiresAcknowledgement: boolean
  acknowledgementDueAt: Date | null
  /** True until they open it. */
  unread: boolean
  acknowledged: boolean
  acknowledgedAt: Date | null
  /** They agreed to an earlier wording and are being asked again. */
  needsReacknowledgement: boolean
  /** The content changed after they last looked at it. */
  revisedSinceViewed: boolean
  status: string
  authorName: string | null
}

/** What the employee home screen needs, without loading the whole inbox. */
export interface InboxDigest {
  unreadCount: number
  acknowledgementsDue: number
  overdueAcknowledgements: number
  /** The single most demanding item, or null when there is nothing to do. */
  headline: InboxItem | null
  urgentUnread: number
}

function assertOwnInbox(actor: Actor, employmentId: string): void {
  // Self-access is ownership. Nobody reads somebody else's inbox, whatever
  // capabilities they hold - receipts are the supported way to see status.
  if (!isSelf(actor, employmentId)) throw new ForbiddenError('inbox.self')
}

const PRIORITY_RANK: Record<string, number> = {
  emergency: 0,
  urgent: 1,
  important: 2,
  normal: 3,
}

export async function listInbox(
  tx: Tx,
  actor: Actor,
  employmentId: string,
  options: { filter?: InboxFilter; categoryKey?: string; search?: string } = {},
): Promise<InboxItem[]> {
  assertOwnInbox(actor, employmentId)
  const filter = options.filter ?? 'all'

  const rows = await tx
    .select({
      recipientId: announcementRecipients.id,
      announcementId: announcements.id,
      title: announcementRevisions.title,
      body: announcementRevisions.body,
      revisionCreatedAt: announcementRevisions.createdAt,
      priority: announcements.priority,
      categoryKey: announcementCategories.key,
      categoryName: announcementCategories.name,
      publishedAt: announcements.publishedAt,
      expiresAt: announcements.expiresAt,
      requiresAcknowledgement: announcements.requiresAcknowledgement,
      acknowledgementDueAt: announcements.acknowledgementDueAt,
      status: announcements.status,
      firstViewedAt: announcementRecipients.firstViewedAt,
      lastViewedAt: announcementRecipients.lastViewedAt,
      acknowledgedAt: announcementRecipients.acknowledgedAt,
      acknowledgedRevisionId: announcementRecipients.acknowledgedRevisionId,
      reacknowledgementRequestedAt: announcementRecipients.reacknowledgementRequestedAt,
      currentRevisionId: announcements.currentRevisionId,
      authorName: employments.displayName,
    })
    .from(announcementRecipients)
    .innerJoin(
      announcements,
      and(
        eq(announcements.organizationId, announcementRecipients.organizationId),
        eq(announcements.id, announcementRecipients.announcementId),
      ),
    )
    .innerJoin(
      announcementRevisions,
      and(
        eq(announcementRevisions.organizationId, announcements.organizationId),
        eq(announcementRevisions.id, announcements.currentRevisionId),
      ),
    )
    .innerJoin(
      announcementCategories,
      and(
        eq(announcementCategories.organizationId, announcements.organizationId),
        eq(announcementCategories.id, announcements.categoryId),
      ),
    )
    .leftJoin(
      employments,
      and(
        eq(employments.organizationId, announcements.organizationId),
        eq(employments.id, announcements.createdByEmploymentId),
      ),
    )
    .where(
      and(
        eq(announcementRecipients.organizationId, actor.organizationId),
        eq(announcementRecipients.employmentId, employmentId),
        // An archived announcement disappears from the active inbox but stays
        // reachable under the archived filter, so somebody can go back and
        // check what they agreed to.
        filter === 'archived'
          ? or(eq(announcements.status, 'archived'), eq(announcements.status, 'expired'))
          : and(ne(announcements.status, 'archived'), ne(announcements.status, 'expired')),
        options.categoryKey ? eq(announcementCategories.key, options.categoryKey) : undefined,
        filter === 'unread' ? isNull(announcementRecipients.firstViewedAt) : undefined,
        filter === 'acknowledge'
          ? and(
              eq(announcements.requiresAcknowledgement, true),
              or(
                isNull(announcementRecipients.acknowledgedAt),
                sql`${announcementRecipients.reacknowledgementRequestedAt} is not null`,
              ),
            )
          : undefined,
        options.search
          ? sql`(${announcementRevisions.title} ilike ${'%' + options.search + '%'} or ${announcementRevisions.body} ilike ${'%' + options.search + '%'})`
          : undefined,
      ),
    )
    .orderBy(desc(announcements.publishedAt))

  const items: InboxItem[] = rows.map((row) => {
    const needsReack =
      row.requiresAcknowledgement &&
      row.acknowledgedAt !== null &&
      row.reacknowledgementRequestedAt !== null
    return {
      recipientId: row.recipientId,
      announcementId: row.announcementId,
      title: row.title,
      preview: previewOf(row.body),
      priority: row.priority as AnnouncementPriority,
      categoryKey: row.categoryKey,
      categoryName: row.categoryName,
      publishedAt: row.publishedAt,
      expiresAt: row.expiresAt,
      requiresAcknowledgement: row.requiresAcknowledgement,
      acknowledgementDueAt: row.acknowledgementDueAt,
      unread: row.firstViewedAt === null,
      acknowledged: row.acknowledgedAt !== null && !needsReack,
      acknowledgedAt: row.acknowledgedAt,
      needsReacknowledgement: needsReack,
      revisedSinceViewed:
        row.lastViewedAt !== null && row.revisionCreatedAt.getTime() > row.lastViewedAt.getTime(),
      status: row.status,
      authorName: row.authorName,
    }
  })

  return sortInbox(items)
}

/** Exported so the ordering rule can be unit-tested without a database. */
export function sortInbox(items: InboxItem[]): InboxItem[] {
  return [...items].sort((a, b) => {
    const aTodo = outstandingAcknowledgement(a)
    const bTodo = outstandingAcknowledgement(b)
    if (aTodo !== bTodo) return aTodo ? -1 : 1

    if (aTodo && bTodo) {
      const aDue = a.acknowledgementDueAt?.getTime() ?? Number.MAX_SAFE_INTEGER
      const bDue = b.acknowledgementDueAt?.getTime() ?? Number.MAX_SAFE_INTEGER
      if (aDue !== bDue) return aDue - bDue
    }

    const aPinned = isPinned(a)
    const bPinned = isPinned(b)
    if (aPinned !== bPinned) return aPinned ? -1 : 1

    const rank = (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3)
    if (aPinned && bPinned && rank !== 0) return rank

    return (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0)
  })
}

export function outstandingAcknowledgement(item: InboxItem): boolean {
  return item.requiresAcknowledgement && (!item.acknowledged || item.needsReacknowledgement)
}

/**
 * Urgent and emergency stay at the top until they are dealt with - read for an
 * ordinary urgent notice, acknowledged when one is required. Once handled they
 * fall back into date order rather than shouting indefinitely.
 */
export function isPinned(item: InboxItem): boolean {
  if (item.priority !== 'urgent' && item.priority !== 'emergency') return false
  return item.requiresAcknowledgement ? outstandingAcknowledgement(item) : item.unread
}

function previewOf(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim()
  return flat.length <= 160 ? flat : `${flat.slice(0, 159).trimEnd()}…`
}

export async function inboxDigest(
  tx: Tx,
  actor: Actor,
  employmentId: string,
): Promise<InboxDigest> {
  const items = await listInbox(tx, actor, employmentId, { filter: 'all' })
  const now = Date.now()

  const outstanding = items.filter(outstandingAcknowledgement)
  const overdue = outstanding.filter(
    (i) => i.acknowledgementDueAt !== null && i.acknowledgementDueAt.getTime() < now,
  )

  return {
    unreadCount: items.filter((i) => i.unread).length,
    acknowledgementsDue: outstanding.length,
    overdueAcknowledgements: overdue.length,
    urgentUnread: items.filter((i) => i.unread && isPinned(i)).length,
    headline: items[0] ?? null,
  }
}

export interface InboxDetail extends InboxItem {
  body: string
  callToActionLabel: string | null
  callToActionHref: string | null
  revisionNumber: number
  revisionNote: string | null
  /** The wording they previously agreed to, when a re-acknowledgement is due. */
  acknowledgedRevisionNumber: number | null
}

/**
 * Open one announcement.
 *
 * `record` defaults to true: opening it is a view. It is a parameter because a
 * preview must be able to render the same detail without marking anything.
 */
export async function openAnnouncement(
  tx: Tx,
  actor: Actor,
  employmentId: string,
  announcementId: string,
  options: { record?: boolean; now?: Date } = {},
): Promise<InboxDetail> {
  assertOwnInbox(actor, employmentId)
  const now = options.now ?? new Date()

  const [row] = await tx
    .select({
      recipientId: announcementRecipients.id,
      announcementId: announcements.id,
      title: announcementRevisions.title,
      body: announcementRevisions.body,
      revisionNumber: announcementRevisions.revisionNumber,
      revisionNote: announcementRevisions.note,
      revisionCreatedAt: announcementRevisions.createdAt,
      callToActionLabel: announcementRevisions.callToActionLabel,
      callToActionHref: announcementRevisions.callToActionHref,
      priority: announcements.priority,
      categoryKey: announcementCategories.key,
      categoryName: announcementCategories.name,
      publishedAt: announcements.publishedAt,
      expiresAt: announcements.expiresAt,
      requiresAcknowledgement: announcements.requiresAcknowledgement,
      acknowledgementDueAt: announcements.acknowledgementDueAt,
      status: announcements.status,
      firstViewedAt: announcementRecipients.firstViewedAt,
      lastViewedAt: announcementRecipients.lastViewedAt,
      acknowledgedAt: announcementRecipients.acknowledgedAt,
      acknowledgedRevisionId: announcementRecipients.acknowledgedRevisionId,
      reacknowledgementRequestedAt: announcementRecipients.reacknowledgementRequestedAt,
      authorName: employments.displayName,
    })
    .from(announcementRecipients)
    .innerJoin(
      announcements,
      and(
        eq(announcements.organizationId, announcementRecipients.organizationId),
        eq(announcements.id, announcementRecipients.announcementId),
      ),
    )
    .innerJoin(
      announcementRevisions,
      and(
        eq(announcementRevisions.organizationId, announcements.organizationId),
        eq(announcementRevisions.id, announcements.currentRevisionId),
      ),
    )
    .innerJoin(
      announcementCategories,
      and(
        eq(announcementCategories.organizationId, announcements.organizationId),
        eq(announcementCategories.id, announcements.categoryId),
      ),
    )
    .leftJoin(
      employments,
      and(
        eq(employments.organizationId, announcements.organizationId),
        eq(employments.id, announcements.createdByEmploymentId),
      ),
    )
    .where(
      and(
        eq(announcementRecipients.organizationId, actor.organizationId),
        eq(announcementRecipients.employmentId, employmentId),
        eq(announcementRecipients.announcementId, announcementId),
      ),
    )
    .limit(1)

  // Not a recipient is indistinguishable from does not exist.
  if (!row) throw new NotFoundError('Announcement not found')

  if (options.record !== false) {
    await tx
      .update(announcementRecipients)
      .set({
        firstViewedAt: row.firstViewedAt ?? now,
        lastViewedAt: now,
        viewCount: sql`${announcementRecipients.viewCount} + 1`,
      })
      .where(
        and(
          eq(announcementRecipients.organizationId, actor.organizationId),
          eq(announcementRecipients.id, row.recipientId),
        ),
      )
  }

  let acknowledgedRevisionNumber: number | null = null
  if (row.acknowledgedRevisionId) {
    const [prior] = await tx
      .select({ revisionNumber: announcementRevisions.revisionNumber })
      .from(announcementRevisions)
      .where(
        and(
          eq(announcementRevisions.organizationId, actor.organizationId),
          eq(announcementRevisions.id, row.acknowledgedRevisionId),
        ),
      )
      .limit(1)
    acknowledgedRevisionNumber = prior?.revisionNumber ?? null
  }

  const needsReack =
    row.requiresAcknowledgement &&
    row.acknowledgedAt !== null &&
    row.reacknowledgementRequestedAt !== null

  return {
    recipientId: row.recipientId,
    announcementId: row.announcementId,
    title: row.title,
    body: row.body,
    preview: previewOf(row.body),
    revisionNumber: row.revisionNumber,
    revisionNote: row.revisionNote,
    callToActionLabel: row.callToActionLabel,
    callToActionHref: row.callToActionHref,
    priority: row.priority as AnnouncementPriority,
    categoryKey: row.categoryKey,
    categoryName: row.categoryName,
    publishedAt: row.publishedAt,
    expiresAt: row.expiresAt,
    requiresAcknowledgement: row.requiresAcknowledgement,
    acknowledgementDueAt: row.acknowledgementDueAt,
    unread: row.firstViewedAt === null,
    acknowledged: row.acknowledgedAt !== null && !needsReack,
    acknowledgedAt: row.acknowledgedAt,
    needsReacknowledgement: needsReack,
    revisedSinceViewed:
      row.lastViewedAt !== null && row.revisionCreatedAt.getTime() > row.lastViewedAt.getTime(),
    acknowledgedRevisionNumber,
    status: row.status,
    authorName: row.authorName,
  }
}

/**
 * Record an explicit acknowledgement.
 *
 * Only ever called from a deliberate action. Stamps the revision that was on
 * screen, and clears any outstanding re-acknowledgement request - the earlier
 * acknowledgement is superseded in effect but the audit event for it remains.
 */
export async function acknowledge(
  tx: Tx,
  actor: Actor,
  employmentId: string,
  announcementId: string,
  now = new Date(),
): Promise<void> {
  assertOwnInbox(actor, employmentId)

  const [row] = await tx
    .select({
      recipientId: announcementRecipients.id,
      requiresAcknowledgement: announcements.requiresAcknowledgement,
      currentRevisionId: announcements.currentRevisionId,
      title: announcementRevisions.title,
      revisionNumber: announcementRevisions.revisionNumber,
      status: announcements.status,
    })
    .from(announcementRecipients)
    .innerJoin(
      announcements,
      and(
        eq(announcements.organizationId, announcementRecipients.organizationId),
        eq(announcements.id, announcementRecipients.announcementId),
      ),
    )
    .innerJoin(
      announcementRevisions,
      and(
        eq(announcementRevisions.organizationId, announcements.organizationId),
        eq(announcementRevisions.id, announcements.currentRevisionId),
      ),
    )
    .where(
      and(
        eq(announcementRecipients.organizationId, actor.organizationId),
        eq(announcementRecipients.employmentId, employmentId),
        eq(announcementRecipients.announcementId, announcementId),
      ),
    )
    .limit(1)

  if (!row) throw new NotFoundError('Announcement not found')
  if (!row.requiresAcknowledgement) {
    // Nothing to acknowledge. Silently succeeding would produce a record of
    // consent to something nobody was asked to consent to.
    throw new NotFoundError('This announcement does not ask for acknowledgement')
  }

  await tx
    .update(announcementRecipients)
    .set({
      acknowledgedAt: now,
      acknowledgedRevisionId: row.currentRevisionId,
      reacknowledgementRequestedAt: null,
      // Acknowledging is also a view, for anyone who arrived by deep link.
      firstViewedAt: sql`coalesce(${announcementRecipients.firstViewedAt}, ${now})`,
      lastViewedAt: now,
    })
    .where(
      and(
        eq(announcementRecipients.organizationId, actor.organizationId),
        eq(announcementRecipients.id, row.recipientId),
      ),
    )

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.ANNOUNCEMENT_ACKNOWLEDGED,
    summary: `Acknowledged "${row.title}" (revision ${row.revisionNumber})`,
    subjectType: 'announcement',
    subjectId: announcementId,
    metadata: { revisionNumber: row.revisionNumber },
  })
}

/** Categories present in this person's inbox, for the filter control. */
export async function inboxCategories(
  tx: Tx,
  actor: Actor,
  employmentId: string,
): Promise<{ key: string; name: string; count: number }[]> {
  assertOwnInbox(actor, employmentId)

  const rows = await tx
    .select({
      key: announcementCategories.key,
      name: announcementCategories.name,
      count: sql<number>`count(*)`,
    })
    .from(announcementRecipients)
    .innerJoin(
      announcements,
      and(
        eq(announcements.organizationId, announcementRecipients.organizationId),
        eq(announcements.id, announcementRecipients.announcementId),
      ),
    )
    .innerJoin(
      announcementCategories,
      and(
        eq(announcementCategories.organizationId, announcements.organizationId),
        eq(announcementCategories.id, announcements.categoryId),
      ),
    )
    .where(
      and(
        eq(announcementRecipients.organizationId, actor.organizationId),
        eq(announcementRecipients.employmentId, employmentId),
        ne(announcements.status, 'archived'),
      ),
    )
    .groupBy(announcementCategories.key, announcementCategories.name)
    .orderBy(announcementCategories.name)

  return rows.map((r) => ({ ...r, count: Number(r.count) }))
}
