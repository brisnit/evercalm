import { and, asc, count, desc, eq, inArray, isNull, lte, ne, sql } from 'drizzle-orm'
import type { Tx } from '@/server/db/types'
import type { Actor } from '@/server/authz/actor'
import type { Capability } from '@/server/authz'
import { accessibleLocationIds, canAtAnyLocation } from '@/server/authz/can'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { newId } from '@/lib/ids'
import { AUDIT_ACTIONS, recordAuditEvent, recordSystemAuditEvent } from '@/server/audit'
import { resolveActor } from '@/server/authz/resolve'
import { employments } from '@/server/db/schema'
import { enqueue, cancelForSubject, type EnqueueInput } from '@/modules/notifications/service'
import { deliveryPolicy } from './delivery-policy'
import {
  MAX_BODY_LENGTH,
  MAX_TITLE_LENGTH,
  isSafeHref,
  normalizeBody,
  normalizeTitle,
  preview as buildPreview,
} from './content'
import {
  assertRulesWithinScope,
  describeAudience,
  publishingScope,
  resolveAudience,
  resolveSelectorLabels,
  type AudienceRuleInput,
} from './audience'
import {
  announcementAudience,
  announcementCategories,
  announcementRecipients,
  announcementRevisions,
  announcements,
  type AnnouncementPriority,
  type AnnouncementStatus,
} from './schema'

/**
 * ANNOUNCEMENT LIFECYCLE.
 *
 *   draft ─publish──────────────► published ─(expires_at passes)─► expired
 *     │                              │                                │
 *     └─schedule─► scheduled ────────┘                                │
 *                    │  └─cancel──► draft                             │
 *                    │                                                │
 *                    └────────────── archive ◄────────────────────────┘
 *
 * The invariant everything else follows from: **recipients exist only for
 * published announcements**. A draft or a scheduled announcement has none, so
 * nothing can be delivered, viewed or acknowledged, and cancelling a schedule
 * leaves no trace on anybody's inbox.
 *
 * Editing after publication does not mutate content. It appends a revision.
 * See schema.ts for why acknowledgement makes that mandatory rather than tidy.
 */

/**
 * The entry check for an authoring or publishing action.
 *
 * Asked with `canAtAnyLocation`, deliberately. A grant scoped to one location
 * cannot satisfy the organization-wide question, so `authorize(actor, cap)`
 * with no location would refuse a General Manager for their own site - the
 * family of bugs documented in docs/permissions.md.
 *
 * This is a gate, not the control. WHERE an announcement may go is decided by
 * `assertRulesWithinScope`, which checks every audience rule against the
 * author's actual locations, on save and again on publish.
 */
function authorizeSomewhere(actor: Actor, capability: Capability): void {
  if (!canAtAnyLocation(actor, capability)) throw new ForbiddenError(capability)
}

const PRIORITY_LABELS: Record<AnnouncementPriority, string> = {
  normal: 'Normal',
  important: 'Important',
  urgent: 'Urgent',
  emergency: 'Emergency',
}

export function priorityLabel(priority: string): string {
  return PRIORITY_LABELS[priority as AnnouncementPriority] ?? 'Normal'
}

/** Priorities that pin an announcement to the top until it is dealt with. */
export const PINNED_PRIORITIES = new Set<AnnouncementPriority>(['urgent', 'emergency'])

export interface AnnouncementInput {
  title: string
  body: string
  categoryId: string
  priority: AnnouncementPriority
  requiresAcknowledgement: boolean
  acknowledgementDueAt: Date | null
  expiresAt: Date | null
  callToActionLabel: string | null
  callToActionHref: string | null
  eventId: string | null
}

export interface AnnouncementSummary {
  id: string
  title: string
  status: AnnouncementStatus
  priority: AnnouncementPriority
  categoryName: string
  categoryKey: string
  requiresAcknowledgement: boolean
  publishAt: Date | null
  publishedAt: Date | null
  expiresAt: Date | null
  acknowledgementDueAt: Date | null
  revisionNumber: number
  recipientCount: number
  viewedCount: number
  acknowledgedCount: number
  authorName: string | null
  updatedAt: Date
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validate(input: AnnouncementInput): {
  title: string
  body: string
} {
  const fieldErrors: Record<string, string[]> = {}

  const title = normalizeTitle(input.title)
  if (title.length < 3) fieldErrors.title = ['Give the announcement a title.']
  else if (input.title.length > MAX_TITLE_LENGTH) {
    fieldErrors.title = [`Keep the title under ${MAX_TITLE_LENGTH} characters.`]
  }

  const body = normalizeBody(input.body)
  if (body.length < 3) fieldErrors.body = ['Write what you want people to know.']
  else if (input.body.length > MAX_BODY_LENGTH) {
    fieldErrors.body = [`Keep the message under ${MAX_BODY_LENGTH} characters.`]
  }

  if (input.callToActionHref && !isSafeHref(input.callToActionHref)) {
    fieldErrors.callToActionHref = ['Use a web address starting http://, https:// or mailto:.']
  }
  if (input.callToActionHref && !input.callToActionLabel?.trim()) {
    fieldErrors.callToActionLabel = ['Give the button a label.']
  }
  if (input.acknowledgementDueAt && !input.requiresAcknowledgement) {
    fieldErrors.acknowledgementDueAt = [
      'Only a message that needs acknowledging can have a deadline.',
    ]
  }
  if (input.expiresAt && input.expiresAt.getTime() < Date.now()) {
    fieldErrors.expiresAt = ['That expiry is already in the past.']
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw new ValidationError(fieldErrors, 'Check the announcement before continuing.')
  }
  return { title, body }
}

/**
 * Emergency is its own capability, checked at every gate that could distribute
 * one. It overrides every preference and quiet hour, so it must not be
 * reachable by someone who merely holds `announcement.publish_urgent`.
 */
function assertMayUsePriority(actor: Actor, priority: AnnouncementPriority): void {
  if (priority === 'emergency') authorizeSomewhere(actor, 'announcement.publish_emergency')
  if (priority === 'urgent') authorizeSomewhere(actor, 'announcement.publish_urgent')
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export interface CategoryView {
  id: string
  key: string
  name: string
  description: string
  overridesPreferences: boolean
}

export async function listCategories(tx: Tx, organizationId: string): Promise<CategoryView[]> {
  return tx
    .select({
      id: announcementCategories.id,
      key: announcementCategories.key,
      name: announcementCategories.name,
      description: announcementCategories.description,
      overridesPreferences: announcementCategories.overridesPreferences,
    })
    .from(announcementCategories)
    .where(
      and(
        eq(announcementCategories.organizationId, organizationId),
        isNull(announcementCategories.archivedAt),
      ),
    )
    .orderBy(asc(announcementCategories.position))
}

// ---------------------------------------------------------------------------
// Authoring
// ---------------------------------------------------------------------------

export async function createAnnouncement(
  tx: Tx,
  actor: Actor,
  input: AnnouncementInput,
  rules: readonly AudienceRuleInput[],
): Promise<string> {
  authorizeSomewhere(actor, 'announcement.create')
  assertMayUsePriority(actor, input.priority)
  const { title, body } = validate(input)
  await assertRulesWithinScope(tx, actor, rules)
  await assertCategoryExists(tx, actor.organizationId, input.categoryId)

  const announcementId = newId()
  const revisionId = newId()

  await tx.insert(announcements).values({
    id: announcementId,
    organizationId: actor.organizationId,
    categoryId: input.categoryId,
    status: 'draft',
    priority: input.priority,
    requiresAcknowledgement: input.requiresAcknowledgement,
    acknowledgementDueAt: input.acknowledgementDueAt,
    expiresAt: input.expiresAt,
    eventId: input.eventId,
    createdByEmploymentId: actor.employmentId,
    updatedByEmploymentId: actor.employmentId,
  })

  await tx.insert(announcementRevisions).values({
    id: revisionId,
    organizationId: actor.organizationId,
    announcementId,
    revisionNumber: 1,
    title,
    body,
    callToActionLabel: input.callToActionLabel,
    callToActionHref: input.callToActionHref,
    isMaterial: false,
    createdByEmploymentId: actor.employmentId,
  })

  await tx
    .update(announcements)
    .set({ currentRevisionId: revisionId })
    .where(
      and(
        eq(announcements.organizationId, actor.organizationId),
        eq(announcements.id, announcementId),
      ),
    )

  await replaceAudience(tx, actor, announcementId, rules)

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.ANNOUNCEMENT_CREATED,
    summary: `Drafted the announcement "${title}"`,
    subjectType: 'announcement',
    subjectId: announcementId,
    metadata: { priority: input.priority },
  })

  return announcementId
}

async function assertCategoryExists(
  tx: Tx,
  organizationId: string,
  categoryId: string,
): Promise<CategoryView> {
  const [row] = await tx
    .select({
      id: announcementCategories.id,
      key: announcementCategories.key,
      name: announcementCategories.name,
      description: announcementCategories.description,
      overridesPreferences: announcementCategories.overridesPreferences,
    })
    .from(announcementCategories)
    .where(
      and(
        eq(announcementCategories.organizationId, organizationId),
        eq(announcementCategories.id, categoryId),
      ),
    )
    .limit(1)
  if (!row) {
    throw new ValidationError({ categoryId: ['Choose a category.'] }, 'Unknown category')
  }
  return row
}

/** Editing a draft rewrites revision 1 in place; there is nothing to preserve. */
export async function updateDraft(
  tx: Tx,
  actor: Actor,
  announcementId: string,
  input: AnnouncementInput,
  rules: readonly AudienceRuleInput[],
): Promise<void> {
  authorizeSomewhere(actor, 'announcement.create')
  assertMayUsePriority(actor, input.priority)
  const record = await requireAnnouncement(tx, actor, announcementId)
  if (record.status !== 'draft' && record.status !== 'scheduled') {
    throw new ValidationError(
      {},
      'This announcement is already published. Publish a correction instead.',
    )
  }
  const { title, body } = validate(input)
  await assertRulesWithinScope(tx, actor, rules)
  await assertCategoryExists(tx, actor.organizationId, input.categoryId)

  await tx
    .update(announcements)
    .set({
      categoryId: input.categoryId,
      priority: input.priority,
      requiresAcknowledgement: input.requiresAcknowledgement,
      acknowledgementDueAt: input.acknowledgementDueAt,
      expiresAt: input.expiresAt,
      eventId: input.eventId,
      updatedByEmploymentId: actor.employmentId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(announcements.organizationId, actor.organizationId),
        eq(announcements.id, announcementId),
      ),
    )

  /*
   * A draft has exactly one revision and nobody has been shown it, so editing
   * rewrites that row IN PLACE. Deleting and reinserting would work too, but
   * it would mean the runtime role needs DELETE on the revision table - and
   * "content history cannot be destroyed" is worth more than the convenience.
   * DELETE is revoked in migration 0012.
   */
  await tx
    .update(announcementRevisions)
    .set({
      title,
      body,
      callToActionLabel: input.callToActionLabel,
      callToActionHref: input.callToActionHref,
    })
    .where(
      and(
        eq(announcementRevisions.organizationId, actor.organizationId),
        eq(announcementRevisions.announcementId, announcementId),
        eq(announcementRevisions.revisionNumber, 1),
      ),
    )

  await replaceAudience(tx, actor, announcementId, rules)

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.ANNOUNCEMENT_UPDATED,
    summary: `Edited the draft announcement "${title}"`,
    subjectType: 'announcement',
    subjectId: announcementId,
  })
}

async function replaceAudience(
  tx: Tx,
  actor: Actor,
  announcementId: string,
  rules: readonly AudienceRuleInput[],
): Promise<void> {
  await tx
    .delete(announcementAudience)
    .where(
      and(
        eq(announcementAudience.organizationId, actor.organizationId),
        eq(announcementAudience.announcementId, announcementId),
      ),
    )
  if (rules.length === 0) return

  // De-duplicate so the unique constraint is never the thing that reports a
  // repeated selection back to the author.
  const seen = new Set<string>()
  const rows = rules
    .filter((r) => {
      const key = `${r.mode}:${r.selectorType}:${r.selectorId ?? ''}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((r) => ({
      id: newId(),
      organizationId: actor.organizationId,
      announcementId,
      mode: r.mode,
      selectorType: r.selectorType,
      selectorId: r.selectorId,
    }))

  await tx.insert(announcementAudience).values(rows)
}

// ---------------------------------------------------------------------------
// Audience preview
// ---------------------------------------------------------------------------

export interface AudiencePreview {
  summary: string
  count: number
  sample: string[]
  rules: AudienceRuleInput[]
}

export async function previewAudience(
  tx: Tx,
  actor: Actor,
  rules: readonly AudienceRuleInput[],
): Promise<AudiencePreview> {
  authorizeSomewhere(actor, 'announcement.create')
  await assertRulesWithinScope(tx, actor, rules)

  const labels = await resolveSelectorLabels(tx, actor.organizationId, rules)
  const scope = publishingScope(actor)
  const people = await resolveAudience(tx, actor.organizationId, rules, {
    restrictToLocationIds: scope.organizationWide ? null : scope.locationIds,
  })

  return {
    summary: describeAudience(labels, rules),
    count: people.length,
    sample: people.slice(0, 6).map((p) => p.displayName),
    rules: [...rules],
  }
}

export async function loadAudienceRules(
  tx: Tx,
  organizationId: string,
  announcementId: string,
): Promise<AudienceRuleInput[]> {
  const rows = await tx
    .select({
      mode: announcementAudience.mode,
      selectorType: announcementAudience.selectorType,
      selectorId: announcementAudience.selectorId,
    })
    .from(announcementAudience)
    .where(
      and(
        eq(announcementAudience.organizationId, organizationId),
        eq(announcementAudience.announcementId, announcementId),
      ),
    )
    .orderBy(asc(announcementAudience.createdAt))
  return rows as AudienceRuleInput[]
}

// ---------------------------------------------------------------------------
// Publication
// ---------------------------------------------------------------------------

export interface PublishOutcome {
  recipients: number
  notified: number
  suppressed: number
  delayed: number
}

export async function publishAnnouncement(
  tx: Tx,
  actor: Actor,
  announcementId: string,
  options: { now?: Date } = {},
): Promise<PublishOutcome> {
  authorizeSomewhere(actor, 'announcement.publish')
  const now = options.now ?? new Date()
  const record = await requireAnnouncement(tx, actor, announcementId)

  if (record.status === 'published') {
    throw new ValidationError({}, 'This announcement is already published.')
  }
  if (record.status === 'archived') {
    throw new ValidationError({}, 'This announcement is archived.')
  }
  assertMayUsePriority(actor, record.priority as AnnouncementPriority)

  const rules = await loadAudienceRules(tx, actor.organizationId, announcementId)
  if (rules.filter((r) => r.mode === 'include').length === 0) {
    throw new ValidationError(
      { audience: ['Choose who should receive this.'] },
      'Choose who should receive this before publishing.',
    )
  }
  // Re-checked at publication, not just when the draft was saved: a manager
  // whose scope narrowed in between must not still publish the wider audience.
  await assertRulesWithinScope(tx, actor, rules)

  await tx
    .update(announcements)
    .set({
      status: 'published',
      publishedAt: now,
      publishAt: null,
      publishedByEmploymentId: actor.employmentId,
      publishFailedAt: null,
      publishFailureReason: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(announcements.organizationId, actor.organizationId),
        eq(announcements.id, announcementId),
      ),
    )

  const outcome = await materializeRecipients(tx, actor, announcementId, now)

  await recordAuditEvent(tx, actor, {
    action:
      record.priority === 'emergency'
        ? AUDIT_ACTIONS.ANNOUNCEMENT_EMERGENCY_PUBLISHED
        : AUDIT_ACTIONS.ANNOUNCEMENT_PUBLISHED,
    summary: `Published "${record.title}" to ${outcome.recipients} ${
      outcome.recipients === 1 ? 'person' : 'people'
    }`,
    subjectType: 'announcement',
    subjectId: announcementId,
    metadata: {
      priority: record.priority,
      recipients: outcome.recipients,
      requiresAcknowledgement: record.requiresAcknowledgement,
    },
  })

  return outcome
}

/**
 * Create the recipient rows and queue their notifications.
 *
 * Idempotent by construction: the insert conflicts on
 * (organization, announcement, employment) and does nothing, so publishing
 * twice, retrying, or calling `syncRecipients` later never duplicates anybody
 * and never resets somebody's read state.
 */
async function materializeRecipients(
  tx: Tx,
  actor: Actor,
  announcementId: string,
  now: Date,
): Promise<PublishOutcome> {
  const record = await requireAnnouncement(tx, actor, announcementId)
  const rules = await loadAudienceRules(tx, actor.organizationId, announcementId)
  const scope = publishingScope(actor)

  const people = await resolveAudience(tx, actor.organizationId, rules, {
    restrictToLocationIds: scope.organizationWide ? null : scope.locationIds,
  })
  if (people.length === 0) {
    return { recipients: 0, notified: 0, suppressed: 0, delayed: 0 }
  }

  const inserted = await tx
    .insert(announcementRecipients)
    .values(
      people.map((person) => ({
        id: newId(),
        organizationId: actor.organizationId,
        announcementId,
        employmentId: person.employmentId,
        revisionId: record.currentRevisionId!,
        locationIdAtPublish: person.locationId,
        departmentIdAtPublish: person.departmentId,
        jobRoleIdAtPublish: person.jobRoleId,
        deliveryStatus: 'sent' as const,
        deliveredAt: now,
      })),
    )
    .onConflictDoNothing({
      target: [
        announcementRecipients.organizationId,
        announcementRecipients.announcementId,
        announcementRecipients.employmentId,
      ],
    })
    .returning({ employmentId: announcementRecipients.employmentId })

  const category = await assertCategoryExists(tx, actor.organizationId, record.categoryId)
  const policy = deliveryPolicy(record, category)

  const base = (employmentId: string): Omit<EnqueueInput, 'channel'> => ({
    employmentId,
    category: category.key,
    subjectType: 'announcement',
    subjectId: announcementId,
    title: record.title,
    preview: buildPreview(record.body),
    href: `/my/inbox/${announcementId}`,
    overridesPreferences: policy.overridesPreferences,
    overridesQuietHours: policy.overridesQuietHours,
  })

  // In-app first: its counts are what the author is told ("2 after quiet
  // hours"), because in-app is the channel everybody has.
  const queue = await enqueue(
    tx,
    actor.organizationId,
    inserted.map((row) => ({ ...base(row.employmentId), channel: 'in_app' as const })),
    now,
  )
  // Email is queued alongside, under the same policy and the same idempotency
  // rules. It is delivered by the development-safe provider; nothing leaves
  // the machine until a sending domain is approved.
  await enqueue(
    tx,
    actor.organizationId,
    inserted.map((row) => ({ ...base(row.employmentId), channel: 'email' as const })),
    now,
  )

  return {
    recipients: inserted.length,
    notified: queue.created,
    suppressed: queue.suppressed,
    delayed: queue.delayed,
  }
}

/** Add anybody who now matches the audience but has no recipient row yet. */
export async function syncRecipients(
  tx: Tx,
  actor: Actor,
  announcementId: string,
): Promise<PublishOutcome> {
  authorizeSomewhere(actor, 'announcement.publish')
  const record = await requireAnnouncement(tx, actor, announcementId)
  if (record.status !== 'published') {
    throw new ValidationError({}, 'Only a published announcement has recipients.')
  }

  const outcome = await materializeRecipients(tx, actor, announcementId, new Date())
  if (outcome.recipients > 0) {
    await recordAuditEvent(tx, actor, {
      action: AUDIT_ACTIONS.ANNOUNCEMENT_RECIPIENTS_SYNCED,
      summary: `Added ${outcome.recipients} newly matching ${
        outcome.recipients === 1 ? 'recipient' : 'recipients'
      } to "${record.title}"`,
      subjectType: 'announcement',
      subjectId: announcementId,
    })
  }
  return outcome
}

export async function scheduleAnnouncement(
  tx: Tx,
  actor: Actor,
  announcementId: string,
  publishAt: Date,
): Promise<void> {
  authorizeSomewhere(actor, 'announcement.publish')
  const record = await requireAnnouncement(tx, actor, announcementId)
  if (record.status !== 'draft' && record.status !== 'scheduled') {
    throw new ValidationError({}, 'Only a draft can be scheduled.')
  }
  if (publishAt.getTime() <= Date.now()) {
    throw new ValidationError(
      { publishAt: ['Choose a time in the future.'] },
      'That time has already passed.',
    )
  }
  const rules = await loadAudienceRules(tx, actor.organizationId, announcementId)
  if (rules.filter((r) => r.mode === 'include').length === 0) {
    throw new ValidationError(
      { audience: ['Choose who should receive this.'] },
      'Choose who should receive this before scheduling.',
    )
  }
  await assertRulesWithinScope(tx, actor, rules)

  await tx
    .update(announcements)
    .set({
      status: 'scheduled',
      publishAt,
      scheduledByEmploymentId: actor.employmentId,
      publishFailedAt: null,
      publishFailureReason: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(announcements.organizationId, actor.organizationId),
        eq(announcements.id, announcementId),
      ),
    )

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.ANNOUNCEMENT_SCHEDULED,
    summary: `Scheduled "${record.title}" for ${publishAt.toISOString()}`,
    subjectType: 'announcement',
    subjectId: announcementId,
  })
}

export async function cancelSchedule(tx: Tx, actor: Actor, announcementId: string): Promise<void> {
  authorizeSomewhere(actor, 'announcement.publish')
  const record = await requireAnnouncement(tx, actor, announcementId)
  if (record.status !== 'scheduled') {
    throw new ValidationError({}, 'That announcement is not scheduled.')
  }

  await tx
    .update(announcements)
    .set({ status: 'draft', publishAt: null, scheduledByEmploymentId: null, updatedAt: new Date() })
    .where(
      and(
        eq(announcements.organizationId, actor.organizationId),
        eq(announcements.id, announcementId),
      ),
    )

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.ANNOUNCEMENT_SCHEDULE_CANCELLED,
    summary: `Cancelled the scheduled announcement "${record.title}"`,
    subjectType: 'announcement',
    subjectId: announcementId,
  })
}

/*
 * SCHEDULED PUBLICATION, run by the worker.
 *
 * One announcement per call, in its own transaction, so one bad schedule
 * cannot roll back the others. Inside that transaction:
 *
 *   1. CLAIM with a conditional update (status = scheduled AND due). A second
 *      worker blocks on the row lock, then finds it no longer scheduled and
 *      does nothing - so an announcement is published once however many
 *      workers race for it.
 *   2. Re-resolve the person who scheduled it and re-check EVERYTHING their
 *      manual publish would have checked: capability, priority, audience
 *      scope. Their permissions may have changed since they pressed the
 *      button, and a schedule must not become a way round that.
 *   3. Materialise recipients and queue notifications, idempotently.
 *
 * If step 2 refuses, the transaction rolls back (the claim with it) and the
 * worker calls `markScheduleFailed`, which returns it to draft with the reason
 * on the announcement and in the audit log. It is not retried: waiting will
 * not restore somebody's permission. Any OTHER error - the database blipped -
 * also rolls back, leaves it scheduled, and the next tick tries again.
 *
 * AFTER DOWNTIME: anything overdue is published on the first tick. Anything
 * whose expiry has ALSO already passed goes straight to expired without
 * recipients - publishing a notice after the moment it was about would be
 * worse than not publishing it, and the audit log says why.
 */

/** A schedule that cannot go out, for a reason that waiting will not fix. */
export class ScheduledPublishError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScheduledPublishError'
  }
}

export async function listDueScheduled(
  tx: Tx,
  organizationId: string,
  now: Date,
): Promise<string[]> {
  const rows = await tx
    .select({ id: announcements.id })
    .from(announcements)
    .where(
      and(
        eq(announcements.organizationId, organizationId),
        eq(announcements.status, 'scheduled'),
        lte(announcements.publishAt, now),
      ),
    )
    .orderBy(asc(announcements.publishAt))
  return rows.map((row) => row.id)
}

export type ScheduledPublishResult =
  | { kind: 'published'; recipients: number }
  | { kind: 'expired_before_publish' }
  | { kind: 'not_due' }

export async function publishScheduledAnnouncement(
  tx: Tx,
  organizationId: string,
  announcementId: string,
  now: Date,
): Promise<ScheduledPublishResult> {
  const [claimed] = await tx
    .update(announcements)
    .set({ status: 'published', publishedAt: now, updatedAt: now })
    .where(
      and(
        eq(announcements.organizationId, organizationId),
        eq(announcements.id, announcementId),
        eq(announcements.status, 'scheduled'),
        lte(announcements.publishAt, now),
      ),
    )
    .returning({
      expiresAt: announcements.expiresAt,
      scheduledBy: announcements.scheduledByEmploymentId,
    })
  if (!claimed) return { kind: 'not_due' }

  if (claimed.expiresAt && claimed.expiresAt.getTime() <= now.getTime()) {
    await tx
      .update(announcements)
      .set({ status: 'expired', publishedAt: null, publishAt: null, updatedAt: now })
      .where(
        and(eq(announcements.organizationId, organizationId), eq(announcements.id, announcementId)),
      )
    await recordSystemAuditEvent(tx, organizationId, {
      action: AUDIT_ACTIONS.ANNOUNCEMENT_EXPIRED,
      reason: 'Scheduled publication',
      summary: 'A scheduled announcement expired before it could be published, so it was not sent',
      subjectType: 'announcement',
      subjectId: announcementId,
    })
    return { kind: 'expired_before_publish' }
  }

  const actor = await schedulingActor(tx, organizationId, claimed.scheduledBy)
  let record: Awaited<ReturnType<typeof requireAnnouncement>>
  try {
    authorizeSomewhere(actor, 'announcement.publish')
    record = await requireAnnouncement(tx, actor, announcementId)
    assertMayUsePriority(actor, record.priority as AnnouncementPriority)
    const rules = await loadAudienceRules(tx, organizationId, announcementId)
    if (rules.filter((r) => r.mode === 'include').length === 0) {
      throw new ScheduledPublishError('It has no audience.')
    }
    await assertRulesWithinScope(tx, actor, rules)
  } catch (error) {
    if (error instanceof ScheduledPublishError) throw error
    if (error instanceof ForbiddenError) {
      throw new ScheduledPublishError(
        'The person who scheduled it no longer has permission to send it to this audience.',
      )
    }
    if (error instanceof ValidationError) throw new ScheduledPublishError(error.message)
    if (error instanceof NotFoundError) {
      throw new ScheduledPublishError('The person who scheduled it can no longer see it.')
    }
    throw error
  }

  await tx
    .update(announcements)
    .set({ publishAt: null, publishedByEmploymentId: actor.employmentId })
    .where(
      and(eq(announcements.organizationId, organizationId), eq(announcements.id, announcementId)),
    )

  const outcome = await materializeRecipients(tx, actor, announcementId, now)

  await recordAuditEvent(tx, actor, {
    action:
      record.priority === 'emergency'
        ? AUDIT_ACTIONS.ANNOUNCEMENT_EMERGENCY_PUBLISHED
        : AUDIT_ACTIONS.ANNOUNCEMENT_PUBLISHED,
    summary: `Published the scheduled announcement "${record.title}" to ${outcome.recipients} ${
      outcome.recipients === 1 ? 'person' : 'people'
    }`,
    subjectType: 'announcement',
    subjectId: announcementId,
    metadata: { trigger: 'schedule', priority: record.priority, recipients: outcome.recipients },
  })

  return { kind: 'published', recipients: outcome.recipients }
}

async function schedulingActor(
  tx: Tx,
  organizationId: string,
  employmentId: string | null,
): Promise<Actor> {
  if (!employmentId) {
    throw new ScheduledPublishError('Nobody is recorded as having scheduled it.')
  }
  const [person] = await tx
    .select({ userId: employments.userId, status: employments.status })
    .from(employments)
    .where(and(eq(employments.organizationId, organizationId), eq(employments.id, employmentId)))
    .limit(1)
  if (!person?.userId || person.status !== 'active') {
    throw new ScheduledPublishError('The person who scheduled it is no longer active here.')
  }
  const actor = await resolveActor(tx, organizationId, person.userId)
  if (!actor) {
    throw new ScheduledPublishError('The person who scheduled it is no longer active here.')
  }
  return actor
}

/** Return a schedule that could not go out to draft, saying why. */
export async function markScheduleFailed(
  tx: Tx,
  organizationId: string,
  announcementId: string,
  reason: string,
  now: Date,
): Promise<boolean> {
  const rows = await tx
    .update(announcements)
    .set({
      status: 'draft',
      publishAt: null,
      publishFailedAt: now,
      publishFailureReason: reason.slice(0, 300),
      updatedAt: now,
    })
    .where(
      and(
        eq(announcements.organizationId, organizationId),
        eq(announcements.id, announcementId),
        eq(announcements.status, 'scheduled'),
      ),
    )
    .returning({ id: announcements.id })
  if (rows.length === 0) return false

  await recordSystemAuditEvent(tx, organizationId, {
    action: AUDIT_ACTIONS.ANNOUNCEMENT_SCHEDULE_FAILED,
    reason: 'Scheduled publication',
    summary: `A scheduled announcement could not be published and was returned to draft: ${reason}`,
    subjectType: 'announcement',
    subjectId: announcementId,
  })
  return true
}

/**
 * Move published announcements past their expiry into `expired`.
 *
 * Idempotent: the conditional update only matches rows still published.
 * Anything still queued for an expired announcement - a notification held for
 * quiet hours, a reminder - is cancelled rather than delivered late.
 */
export async function expireDue(tx: Tx, organizationId: string, now = new Date()): Promise<number> {
  // SKIP LOCKED: a row another worker is already expiring is left to it, so
  // concurrent workers neither wait on each other nor deadlock.
  const due = await tx
    .select({ id: announcements.id })
    .from(announcements)
    .where(
      and(
        eq(announcements.organizationId, organizationId),
        eq(announcements.status, 'published'),
        lte(announcements.expiresAt, now),
      ),
    )
    .orderBy(asc(announcements.id))
    .for('update', { skipLocked: true })
  if (due.length === 0) return 0

  const rows = await tx
    .update(announcements)
    .set({ status: 'expired', updatedAt: now })
    .where(
      and(
        eq(announcements.organizationId, organizationId),
        inArray(
          announcements.id,
          due.map((row) => row.id),
        ),
        eq(announcements.status, 'published'),
      ),
    )
    .returning({ id: announcements.id })

  for (const row of rows) {
    await cancelForSubject(tx, organizationId, 'announcement', row.id)
    await recordSystemAuditEvent(tx, organizationId, {
      action: AUDIT_ACTIONS.ANNOUNCEMENT_EXPIRED,
      reason: 'Expiry',
      summary: 'An announcement reached its expiry and left active inboxes',
      subjectType: 'announcement',
      subjectId: row.id,
    })
  }
  return rows.length
}

// ---------------------------------------------------------------------------
// Corrections
// ---------------------------------------------------------------------------

export interface RevisionInput {
  title: string
  body: string
  callToActionLabel: string | null
  callToActionHref: string | null
  isMaterial: boolean
  note: string | null
}

/**
 * Correct a published announcement by appending a revision.
 *
 * A MATERIAL revision to something that requires acknowledgement asks everyone
 * to acknowledge again. The previous acknowledgement is not erased - it stays
 * on the row with the revision it was made against, so the history reads
 * "agreed to v1 on the 3rd, asked again on the 9th".
 */
export async function reviseAnnouncement(
  tx: Tx,
  actor: Actor,
  announcementId: string,
  input: RevisionInput,
): Promise<number> {
  authorizeSomewhere(actor, 'announcement.publish')
  const record = await requireAnnouncement(tx, actor, announcementId)
  if (record.status === 'draft') {
    throw new ValidationError({}, 'Edit the draft directly instead of revising it.')
  }

  const title = normalizeTitle(input.title)
  const body = normalizeBody(input.body)
  if (title.length < 3 || body.length < 3) {
    throw new ValidationError(
      { title: title.length < 3 ? ['Give the announcement a title.'] : [] },
      'Check the correction before publishing it.',
    )
  }
  if (input.callToActionHref && !isSafeHref(input.callToActionHref)) {
    throw new ValidationError(
      { callToActionHref: ['Use a web address starting http://, https:// or mailto:.'] },
      'That link is not allowed.',
    )
  }

  const [{ value: maxRevision } = { value: 0 }] = await tx
    .select({ value: sql<number>`coalesce(max(${announcementRevisions.revisionNumber}), 0)` })
    .from(announcementRevisions)
    .where(
      and(
        eq(announcementRevisions.organizationId, actor.organizationId),
        eq(announcementRevisions.announcementId, announcementId),
      ),
    )

  const revisionNumber = Number(maxRevision) + 1
  const revisionId = newId()

  await tx.insert(announcementRevisions).values({
    id: revisionId,
    organizationId: actor.organizationId,
    announcementId,
    revisionNumber,
    title,
    body,
    callToActionLabel: input.callToActionLabel,
    callToActionHref: input.callToActionHref,
    isMaterial: input.isMaterial,
    note: input.note,
    createdByEmploymentId: actor.employmentId,
  })

  await tx
    .update(announcements)
    .set({
      currentRevisionId: revisionId,
      updatedByEmploymentId: actor.employmentId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(announcements.organizationId, actor.organizationId),
        eq(announcements.id, announcementId),
      ),
    )

  if (input.isMaterial && record.requiresAcknowledgement) {
    // Only people who already acknowledged are asked again; anybody still
    // outstanding simply sees the new wording.
    await tx
      .update(announcementRecipients)
      .set({
        reacknowledgementRequestedAt: new Date(),
        // A fresh request for confirmation earns fresh automatic reminders.
        dueSoonRemindedAt: null,
        overdueRemindedAt: null,
      })
      .where(
        and(
          eq(announcementRecipients.organizationId, actor.organizationId),
          eq(announcementRecipients.announcementId, announcementId),
          sql`${announcementRecipients.acknowledgedAt} is not null`,
        ),
      )
  }

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.ANNOUNCEMENT_REVISED,
    summary: `Published revision ${revisionNumber} of "${title}"${
      input.isMaterial ? ' (material — acknowledgement requested again)' : ''
    }`,
    subjectType: 'announcement',
    subjectId: announcementId,
    metadata: { revisionNumber, isMaterial: input.isMaterial },
  })

  return revisionNumber
}

// ---------------------------------------------------------------------------
// Archive, duplicate
// ---------------------------------------------------------------------------

export async function archiveAnnouncement(
  tx: Tx,
  actor: Actor,
  announcementId: string,
): Promise<void> {
  authorizeSomewhere(actor, 'announcement.archive')
  const record = await requireAnnouncement(tx, actor, announcementId)

  await tx
    .update(announcements)
    .set({
      status: 'archived',
      archivedAt: new Date(),
      archivedByEmploymentId: actor.employmentId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(announcements.organizationId, actor.organizationId),
        eq(announcements.id, announcementId),
      ),
    )

  // Anything still queued for it should not arrive after it was retired.
  await cancelForSubject(tx, actor.organizationId, 'announcement', announcementId)

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.ANNOUNCEMENT_ARCHIVED,
    summary: `Archived the announcement "${record.title}"`,
    subjectType: 'announcement',
    subjectId: announcementId,
  })
}

export async function duplicateAnnouncement(
  tx: Tx,
  actor: Actor,
  announcementId: string,
): Promise<string> {
  authorizeSomewhere(actor, 'announcement.create')
  const record = await requireAnnouncement(tx, actor, announcementId)
  const rules = await loadAudienceRules(tx, actor.organizationId, announcementId)

  const newAnnouncementId = await createAnnouncement(
    tx,
    actor,
    {
      title: `${record.title} (copy)`,
      body: record.body,
      categoryId: record.categoryId,
      priority: record.priority as AnnouncementPriority,
      requiresAcknowledgement: record.requiresAcknowledgement,
      acknowledgementDueAt: null,
      expiresAt: null,
      callToActionLabel: record.callToActionLabel,
      callToActionHref: record.callToActionHref,
      eventId: record.eventId,
    },
    rules,
  )

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.ANNOUNCEMENT_DUPLICATED,
    summary: `Duplicated "${record.title}"`,
    subjectType: 'announcement',
    subjectId: newAnnouncementId,
    metadata: { copiedFrom: announcementId },
  })

  return newAnnouncementId
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface AnnouncementRecord {
  id: string
  organizationId: string
  categoryId: string
  categoryKey: string
  categoryName: string
  status: AnnouncementStatus
  priority: string
  currentRevisionId: string | null
  requiresAcknowledgement: boolean
  acknowledgementDueAt: Date | null
  publishAt: Date | null
  /** Set when the worker could not publish a schedule and returned it to draft. */
  publishFailedAt: Date | null
  publishFailureReason: string | null
  publishedAt: Date | null
  expiresAt: Date | null
  eventId: string | null
  createdAt: Date
  updatedAt: Date
  archivedAt: Date | null
  title: string
  body: string
  callToActionLabel: string | null
  callToActionHref: string | null
  revisionNumber: number
  authorName: string | null
}

/**
 * The organization's timezone - what a date and time typed into a form means,
 * and how one is shown back. A manager in Denver typing "9:00" means 9:00 in
 * Denver, whatever timezone the server runs in.
 */
export async function organizationTimeZone(tx: Tx, organizationId: string): Promise<string> {
  const result = await tx.execute<{ timezone: string }>(
    sql`select timezone from organizations where id = ${organizationId}`,
  )
  return result.rows[0]?.timezone ?? 'UTC'
}

export async function requireAnnouncement(
  tx: Tx,
  actor: Actor,
  announcementId: string,
): Promise<AnnouncementRecord> {
  const [row] = await tx
    .select({
      id: announcements.id,
      organizationId: announcements.organizationId,
      categoryId: announcements.categoryId,
      categoryKey: announcementCategories.key,
      categoryName: announcementCategories.name,
      status: announcements.status,
      priority: announcements.priority,
      currentRevisionId: announcements.currentRevisionId,
      requiresAcknowledgement: announcements.requiresAcknowledgement,
      acknowledgementDueAt: announcements.acknowledgementDueAt,
      publishAt: announcements.publishAt,
      publishFailedAt: announcements.publishFailedAt,
      publishFailureReason: announcements.publishFailureReason,
      publishedAt: announcements.publishedAt,
      expiresAt: announcements.expiresAt,
      eventId: announcements.eventId,
      createdAt: announcements.createdAt,
      updatedAt: announcements.updatedAt,
      archivedAt: announcements.archivedAt,
      title: announcementRevisions.title,
      body: announcementRevisions.body,
      callToActionLabel: announcementRevisions.callToActionLabel,
      callToActionHref: announcementRevisions.callToActionHref,
      revisionNumber: announcementRevisions.revisionNumber,
      authorName: employments.displayName,
    })
    .from(announcements)
    .innerJoin(
      announcementCategories,
      and(
        eq(announcementCategories.organizationId, announcements.organizationId),
        eq(announcementCategories.id, announcements.categoryId),
      ),
    )
    .innerJoin(
      announcementRevisions,
      and(
        eq(announcementRevisions.organizationId, announcements.organizationId),
        eq(announcementRevisions.id, announcements.currentRevisionId),
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
        eq(announcements.organizationId, actor.organizationId),
        eq(announcements.id, announcementId),
      ),
    )
    .limit(1)

  // 404 rather than 403: another tenant's announcement must be indistinguishable
  // from one that does not exist.
  if (!row) throw new NotFoundError('Announcement not found')
  return row as AnnouncementRecord
}

/**
 * The authoring list.
 *
 * A location-scoped manager sees the announcements they can act on: their own,
 * plus anything targeted at a location they cover. They do not see another
 * location's internal communication.
 */
export async function listAnnouncements(
  tx: Tx,
  actor: Actor,
  options: { status?: AnnouncementStatus | 'active'; includeArchived?: boolean } = {},
): Promise<AnnouncementSummary[]> {
  authorizeSomewhere(actor, 'announcement.create')

  const rows = await tx
    .select({
      id: announcements.id,
      status: announcements.status,
      priority: announcements.priority,
      categoryName: announcementCategories.name,
      categoryKey: announcementCategories.key,
      requiresAcknowledgement: announcements.requiresAcknowledgement,
      publishAt: announcements.publishAt,
      publishedAt: announcements.publishedAt,
      expiresAt: announcements.expiresAt,
      acknowledgementDueAt: announcements.acknowledgementDueAt,
      updatedAt: announcements.updatedAt,
      title: announcementRevisions.title,
      revisionNumber: announcementRevisions.revisionNumber,
      authorName: employments.displayName,
    })
    .from(announcements)
    .innerJoin(
      announcementCategories,
      and(
        eq(announcementCategories.organizationId, announcements.organizationId),
        eq(announcementCategories.id, announcements.categoryId),
      ),
    )
    .innerJoin(
      announcementRevisions,
      and(
        eq(announcementRevisions.organizationId, announcements.organizationId),
        eq(announcementRevisions.id, announcements.currentRevisionId),
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
        eq(announcements.organizationId, actor.organizationId),
        options.includeArchived ? undefined : ne(announcements.status, 'archived'),
        options.status && options.status !== 'active'
          ? eq(announcements.status, options.status)
          : undefined,
      ),
    )
    .orderBy(desc(announcements.updatedAt))

  const visible = await filterToActorScope(tx, actor, rows)

  const counts = await recipientCounts(
    tx,
    actor.organizationId,
    visible.map((r) => r.id),
  )

  return visible.map((row) => ({
    ...row,
    status: row.status as AnnouncementStatus,
    priority: row.priority as AnnouncementPriority,
    recipientCount: counts.get(row.id)?.total ?? 0,
    viewedCount: counts.get(row.id)?.viewed ?? 0,
    acknowledgedCount: counts.get(row.id)?.acknowledged ?? 0,
  }))
}

/**
 * Hide announcements aimed exclusively at OTHER locations.
 *
 * An org-wide grant sees everything. For a location-scoped manager the rule is
 * subtractive rather than additive, which matters: an organization-wide notice
 * reaches their people, so they need to see it and chase their own outstanding
 * confirmations. Only something targeted solely at sites they do not cover is
 * hidden.
 *
 * Written as "hide when EVERY include is elsewhere" rather than "show when one
 * include is mine", because the additive form silently hid org-wide, role and
 * department announcements from the very managers responsible for the people
 * receiving them.
 */
async function filterToActorScope<T extends { id: string }>(
  tx: Tx,
  actor: Actor,
  rows: T[],
): Promise<T[]> {
  const locationIds = accessibleLocationIds(actor, 'announcement.create')
  if (locationIds === null) return rows
  if (rows.length === 0) return rows
  if (locationIds.length === 0) return []

  const authored = await tx
    .select({ id: announcements.id })
    .from(announcements)
    .where(
      and(
        eq(announcements.organizationId, actor.organizationId),
        eq(announcements.createdByEmploymentId, actor.employmentId),
        inArray(
          announcements.id,
          rows.map((r) => r.id),
        ),
      ),
    )
  const mine = new Set(authored.map((r) => r.id))

  const targeted = await tx
    .select({
      announcementId: announcementAudience.announcementId,
      selectorType: announcementAudience.selectorType,
      selectorId: announcementAudience.selectorId,
    })
    .from(announcementAudience)
    .where(
      and(
        eq(announcementAudience.organizationId, actor.organizationId),
        eq(announcementAudience.mode, 'include'),
        inArray(
          announcementAudience.announcementId,
          rows.map((r) => r.id),
        ),
      ),
    )

  const allowed = new Set(locationIds)
  const rulesByAnnouncement = new Map<string, typeof targeted>()
  for (const rule of targeted) {
    const list = rulesByAnnouncement.get(rule.announcementId) ?? []
    list.push(rule)
    rulesByAnnouncement.set(rule.announcementId, list)
  }

  /** True when a rule names somewhere this manager does not cover. */
  const isElsewhere = (rule: (typeof targeted)[number]): boolean =>
    rule.selectorType === 'location' && rule.selectorId !== null && !allowed.has(rule.selectorId)

  return rows.filter((row) => {
    if (mine.has(row.id)) return true
    const rules = rulesByAnnouncement.get(row.id) ?? []
    if (rules.length === 0) return false
    // Hidden only when every single include points somewhere else.
    return !rules.every(isElsewhere)
  })
}

export interface RecipientCounts {
  total: number
  viewed: number
  acknowledged: number
}

export async function recipientCounts(
  tx: Tx,
  organizationId: string,
  announcementIds: string[],
): Promise<Map<string, RecipientCounts>> {
  const out = new Map<string, RecipientCounts>()
  if (announcementIds.length === 0) return out

  const rows = await tx
    .select({
      announcementId: announcementRecipients.announcementId,
      total: count(),
      viewed: sql<number>`count(*) filter (where ${announcementRecipients.firstViewedAt} is not null)`,
      acknowledged: sql<number>`count(*) filter (where ${announcementRecipients.acknowledgedAt} is not null)`,
    })
    .from(announcementRecipients)
    .where(
      and(
        eq(announcementRecipients.organizationId, organizationId),
        inArray(announcementRecipients.announcementId, announcementIds),
      ),
    )
    .groupBy(announcementRecipients.announcementId)

  for (const row of rows) {
    out.set(row.announcementId, {
      total: Number(row.total),
      viewed: Number(row.viewed),
      acknowledged: Number(row.acknowledged),
    })
  }
  return out
}

export interface RevisionView {
  id: string
  revisionNumber: number
  title: string
  isMaterial: boolean
  note: string | null
  authorName: string | null
  createdAt: Date
}

export async function listRevisions(
  tx: Tx,
  actor: Actor,
  announcementId: string,
): Promise<RevisionView[]> {
  const rows = await tx
    .select({
      id: announcementRevisions.id,
      revisionNumber: announcementRevisions.revisionNumber,
      title: announcementRevisions.title,
      isMaterial: announcementRevisions.isMaterial,
      note: announcementRevisions.note,
      authorName: employments.displayName,
      createdAt: announcementRevisions.createdAt,
    })
    .from(announcementRevisions)
    .leftJoin(
      employments,
      and(
        eq(employments.organizationId, announcementRevisions.organizationId),
        eq(employments.id, announcementRevisions.createdByEmploymentId),
      ),
    )
    .where(
      and(
        eq(announcementRevisions.organizationId, actor.organizationId),
        eq(announcementRevisions.announcementId, announcementId),
      ),
    )
    .orderBy(desc(announcementRevisions.revisionNumber))
  return rows
}
