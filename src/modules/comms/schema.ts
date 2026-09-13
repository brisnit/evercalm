import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { locations, organizations } from '@/modules/org/schema'
import { employments } from '@/modules/people/schema'
import { events } from '@/modules/events/schema'

/**
 * ANNOUNCEMENTS.
 *
 * Five tables, and the split is deliberate:
 *
 *   announcement_categories   tenant-owned rows, not a code enum, so a salon
 *                             can rename "Operations" without a deploy
 *   announcements             the durable thing: status, schedule, audience
 *   announcement_revisions    immutable content history. The CONTENT of an
 *                             announcement lives on a revision, never on the
 *                             announcement, for the same reason onboarding
 *                             content lives on a version
 *   announcement_audience     explicit include/exclude rules, evaluated at
 *                             publication
 *   announcement_recipients   the materialised result, one row per person
 *
 * WHY CONTENT LIVES ON A REVISION. An acknowledgement is a claim about a
 * specific wording - "I read the allergen policy". If an author could edit the
 * text in place, every previous acknowledgement would silently become a claim
 * about text nobody agreed to. So each recipient's acknowledgement records the
 * revision it was made against, and a MATERIAL revision marks outstanding
 * acknowledgements as needing to be made again, without erasing the old ones.
 *
 * WHY RECIPIENTS ARE MATERIALISED AT PUBLICATION rather than resolved on read:
 *
 *   - Receipts need a stable denominator. "12 of 40 acknowledged" must not
 *     change because somebody was hired this morning.
 *   - Reporting must survive people moving. The row snapshots the location,
 *     department and job role the person held WHEN THEY WERE TARGETED, so a
 *     bartender who transfers next month does not rewrite last month's report.
 *   - Acknowledgement is a record with consequences (safety, HR). It has to be
 *     pinned to a person, a revision, and a time.
 *
 * The cost is that somebody hired after publication is not a recipient. That
 * is handled explicitly rather than by recomputing: `syncRecipients` re-runs
 * the audience and inserts only the people who are missing. It is safe to run
 * repeatedly because (organization_id, announcement_id, employment_id) is
 * unique - which is also what makes publication itself idempotent under retry.
 */

export const ANNOUNCEMENT_PRIORITIES = ['normal', 'important', 'urgent', 'emergency'] as const
export type AnnouncementPriority = (typeof ANNOUNCEMENT_PRIORITIES)[number]

/**
 * `scheduled` is a real state rather than "published with a future date": a
 * scheduled announcement has no recipients yet, so nothing can be delivered,
 * viewed, or acknowledged, and cancelling it leaves no trace on anyone.
 */
export const ANNOUNCEMENT_STATUSES = [
  'draft',
  'scheduled',
  'published',
  'expired',
  'archived',
] as const
export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUSES)[number]

/** What an audience rule points at. Defined in ./audience-types. */
export { AUDIENCE_MODES, AUDIENCE_SELECTOR_TYPES } from './audience-types'
export type { AudienceMode, AudienceSelectorType } from './audience-types'

export const DELIVERY_STATUSES = ['pending', 'sent', 'failed', 'suppressed'] as const
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number]

/**
 * Categories are rows so a tenant can rename or add to them later. `key` is
 * stable and machine-readable; `name` is what the tenant sees and may change.
 *
 * `overridesPreferences` is the honest name for "mandatory": a category marked
 * this way reaches people who have switched that category off. It is set on
 * safety, HR and emergency-shaped categories, and changing it is an audited
 * organization setting rather than something an author picks per message.
 */
export const announcementCategories = pgTable(
  'announcement_categories',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    position: integer('position').notNull().default(0),
    overridesPreferences: boolean('overrides_preferences').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    unique('announcement_categories_org_id_unique').on(t.organizationId, t.id),
    unique('announcement_categories_org_key_unique').on(t.organizationId, t.key),
    index('announcement_categories_org_idx').on(t.organizationId),
  ],
)

export const announcements = pgTable(
  'announcements',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id').notNull(),

    status: text('status').notNull().default('draft'),
    priority: text('priority').notNull().default('normal'),

    /** The live content. NULL only between insert and the first revision. */
    currentRevisionId: uuid('current_revision_id'),

    requiresAcknowledgement: boolean('requires_acknowledgement').notNull().default(false),
    acknowledgementDueAt: timestamp('acknowledgement_due_at', { withTimezone: true }),

    /** Set while scheduled; cleared once published. */
    publishAt: timestamp('publish_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),

    /** Optional link to an event the announcement is about. */
    eventId: uuid('event_id'),

    createdByEmploymentId: uuid('created_by_employment_id'),
    updatedByEmploymentId: uuid('updated_by_employment_id'),
    publishedByEmploymentId: uuid('published_by_employment_id'),
    /** Whose permissions a scheduled publication runs with. Re-checked at send. */
    scheduledByEmploymentId: uuid('scheduled_by_employment_id'),
    /** Set when the worker could not publish a schedule and returned it to draft. */
    publishFailedAt: timestamp('publish_failed_at', { withTimezone: true }),
    publishFailureReason: text('publish_failure_reason'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedByEmploymentId: uuid('archived_by_employment_id'),
  },
  (t) => [
    unique('announcements_org_id_unique').on(t.organizationId, t.id),
    check(
      'announcements_status_check',
      sql`status in ('draft','scheduled','published','expired','archived')`,
    ),
    check(
      'announcements_priority_check',
      sql`priority in ('normal','important','urgent','emergency')`,
    ),
    // A scheduled announcement without a time would never publish.
    check(
      'announcements_scheduled_needs_time',
      sql`status <> 'scheduled' or publish_at is not null`,
    ),
    // A deadline on something nobody must acknowledge is a contradiction.
    check(
      'announcements_ack_deadline_needs_ack',
      sql`acknowledgement_due_at is null or requires_acknowledgement`,
    ),
    foreignKey({
      columns: [t.organizationId, t.categoryId],
      foreignColumns: [announcementCategories.organizationId, announcementCategories.id],
      name: 'announcements_category_tenant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.organizationId, t.eventId],
      foreignColumns: [events.organizationId, events.id],
      name: 'announcements_event_tenant_fk',
    }).onDelete('set null'),
    index('announcements_org_status_idx').on(t.organizationId, t.status),
    index('announcements_publish_at_idx').on(t.publishAt),
    index('announcements_due_idx').on(t.status, t.publishAt, t.expiresAt),
  ],
)

/**
 * Immutable content history. Never updated after insert.
 *
 * `isMaterial` is the author's declaration that the meaning changed. A
 * material revision of an announcement that requires acknowledgement asks
 * everyone to acknowledge again; a typo fix does not.
 */
export const announcementRevisions = pgTable(
  'announcement_revisions',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    announcementId: uuid('announcement_id').notNull(),
    revisionNumber: integer('revision_number').notNull(),

    title: text('title').notNull(),
    /** Sanitised at the service boundary. See comms/sanitize.ts. */
    body: text('body').notNull(),
    callToActionLabel: text('call_to_action_label'),
    callToActionHref: text('call_to_action_href'),

    isMaterial: boolean('is_material').notNull().default(false),
    /** Why it was revised. Shown to recipients on a material revision. */
    note: text('note'),

    createdByEmploymentId: uuid('created_by_employment_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('announcement_revisions_org_id_unique').on(t.organizationId, t.id),
    unique('announcement_revisions_number_unique').on(
      t.organizationId,
      t.announcementId,
      t.revisionNumber,
    ),
    foreignKey({
      columns: [t.organizationId, t.announcementId],
      foreignColumns: [announcements.organizationId, announcements.id],
      name: 'announcement_revisions_announcement_tenant_fk',
    }).onDelete('cascade'),
    index('announcement_revisions_announcement_idx').on(t.organizationId, t.announcementId),
  ],
)

/**
 * One explicit rule per row rather than a stored query.
 *
 * COMBINATION SEMANTICS, which the authoring screen states in words:
 *   includes are a UNION   - anyone matching ANY include rule is in
 *   excludes are removed   - anyone matching ANY exclude rule is out
 *   exclude beats include  - always
 *   an `organization` include means everyone, so it needs org-wide permission
 *
 * A union rather than an intersection because that is what managers mean:
 * "bartenders and hosts" is two groups of people, not the empty set of people
 * who are both. Narrowing is expressed with excludes.
 */
export const announcementAudience = pgTable(
  'announcement_audience',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    announcementId: uuid('announcement_id').notNull(),
    mode: text('mode').notNull().default('include'),
    selectorType: text('selector_type').notNull(),
    /** NULL only for the `organization` selector, which needs no target. */
    selectorId: uuid('selector_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('announcement_audience_org_id_unique').on(t.organizationId, t.id),
    unique('announcement_audience_rule_unique').on(
      t.organizationId,
      t.announcementId,
      t.mode,
      t.selectorType,
      t.selectorId,
    ),
    check('announcement_audience_mode_check', sql`mode in ('include','exclude')`),
    check(
      'announcement_audience_selector_check',
      sql`selector_type in ('organization','location','department','job_role','team','station','employment')`,
    ),
    check(
      'announcement_audience_target_check',
      sql`(selector_type = 'organization') = (selector_id is null)`,
    ),
    foreignKey({
      columns: [t.organizationId, t.announcementId],
      foreignColumns: [announcements.organizationId, announcements.id],
      name: 'announcement_audience_announcement_tenant_fk',
    }).onDelete('cascade'),
    index('announcement_audience_announcement_idx').on(t.organizationId, t.announcementId),
  ],
)

/**
 * One row per person, created at publication.
 *
 * The `*AtPublish` columns are a deliberate denormalisation: they are the
 * answer to "who was this sent to, as they were at the time", which is the
 * only version of that question a receipt report can answer honestly once
 * people have moved around.
 */
export const announcementRecipients = pgTable(
  'announcement_recipients',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    announcementId: uuid('announcement_id').notNull(),
    employmentId: uuid('employment_id').notNull(),

    /** The revision this person was targeted at. */
    revisionId: uuid('revision_id').notNull(),

    // --- snapshot, for reporting that survives transfers -------------------
    locationIdAtPublish: uuid('location_id_at_publish'),
    departmentIdAtPublish: uuid('department_id_at_publish'),
    jobRoleIdAtPublish: uuid('job_role_id_at_publish'),

    deliveryStatus: text('delivery_status').notNull().default('pending'),
    deliveryFailureReason: text('delivery_failure_reason'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),

    firstViewedAt: timestamp('first_viewed_at', { withTimezone: true }),
    lastViewedAt: timestamp('last_viewed_at', { withTimezone: true }),
    viewCount: integer('view_count').notNull().default(0),

    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    /** Which wording they agreed to. Never overwritten by a later revision. */
    acknowledgedRevisionId: uuid('acknowledged_revision_id'),
    /** Set when a material revision lands after they had acknowledged. */
    reacknowledgementRequestedAt: timestamp('reacknowledgement_requested_at', {
      withTimezone: true,
    }),

    reminderCount: integer('reminder_count').notNull().default(0),
    /** Automatic reminders, claimed by a conditional update so each is sent once. */
    dueSoonRemindedAt: timestamp('due_soon_reminded_at', { withTimezone: true }),
    overdueRemindedAt: timestamp('overdue_reminded_at', { withTimezone: true }),
    lastRemindedAt: timestamp('last_reminded_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('announcement_recipients_org_id_unique').on(t.organizationId, t.id),
    // The idempotency guarantee: publishing twice cannot duplicate anybody.
    unique('announcement_recipients_person_unique').on(
      t.organizationId,
      t.announcementId,
      t.employmentId,
    ),
    check(
      'announcement_recipients_delivery_check',
      sql`delivery_status in ('pending','sent','failed','suppressed')`,
    ),
    foreignKey({
      columns: [t.organizationId, t.announcementId],
      foreignColumns: [announcements.organizationId, announcements.id],
      name: 'announcement_recipients_announcement_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.organizationId, t.employmentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'announcement_recipients_employment_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.organizationId, t.locationIdAtPublish],
      foreignColumns: [locations.organizationId, locations.id],
      name: 'announcement_recipients_location_tenant_fk',
    }).onDelete('set null'),
    index('announcement_recipients_announcement_idx').on(t.organizationId, t.announcementId),
    index('announcement_recipients_inbox_idx').on(t.organizationId, t.employmentId),
  ],
)
