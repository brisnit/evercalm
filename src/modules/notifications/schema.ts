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
import { organizations } from '@/modules/org/schema'
import { employments } from '@/modules/people/schema'

/**
 * NOTIFICATIONS.
 *
 * One queue, many channels. A notification row is the intent to tell somebody
 * something on one channel; it is not the thing itself. Announcements,
 * schedules (Slice 4) and messaging (Phase 2) all enqueue here rather than
 * each growing their own delivery path.
 *
 * WHAT IS NOT IN A NOTIFICATION ROW: the announcement body. Delivery records
 * outlive the thing they point at, get read by administrators debugging a
 * queue, and may one day be shipped to a channel provider. So a row carries a
 * title, a short non-sensitive preview, and a pointer - never the content, and
 * never anything about the person beyond their employment id.
 *
 * IDEMPOTENCY. `idempotency_key` is unique per organization and is built from
 * (subject, employment, channel, purpose). Publishing twice, retrying a failed
 * job, or two workers racing produce the same key and therefore one row. This
 * is the same guarantee `announcement_recipients` gives, at the delivery layer.
 *
 * QUIET HOURS are applied when a notification is SCHEDULED, not when it is
 * sent: the row is created with `scheduled_for` pushed to the end of the quiet
 * window, so the queue stays a simple "send what is due" loop and the reason a
 * message is late is visible in the data.
 */

export const NOTIFICATION_STATUSES = [
  'pending',
  'sent',
  'failed',
  /** Preferences or quiet hours said no, and the message was not mandatory. */
  'suppressed',
  /** The thing it was about was cancelled before it went out. */
  'cancelled',
] as const
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number]

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    employmentId: uuid('employment_id').notNull(),

    /** From NOTIFICATION_CATEGORIES in server/notifications/types.ts. */
    category: text('category').notNull(),
    /** in_app | email | sms | push. Only the first two are delivered today. */
    channel: text('channel').notNull(),

    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id'),

    title: text('title').notNull(),
    /** Short, non-sensitive. Never the announcement body. */
    preview: text('preview').notNull().default(''),
    /** Where the notification takes you. Always an internal path. */
    href: text('href'),

    status: text('status').notNull().default('pending'),
    /** The category or priority cannot be muted, so preferences were not consulted. */
    mandatory: boolean('mandatory').notNull().default(false),
    /**
     * Allowed to arrive during quiet hours. Narrower than `mandatory` on
     * purpose: only urgent safety/HR and emergencies interrupt somebody's night.
     */
    overridesQuietHours: boolean('overrides_quiet_hours').notNull().default(false),

    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    /** A reason safe to show an administrator. Never a provider secret. */
    failureReason: text('failure_reason'),
    attempts: integer('attempts').notNull().default(0),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    /** A delivery lease. Expires on its own if the worker holding it dies. */
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    /** Completing a delivery must present the token of the claim that made it. */
    claimToken: uuid('claim_token'),

    /** In-app only: when the person dismissed or opened it. */
    readAt: timestamp('read_at', { withTimezone: true }),

    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('notifications_org_id_unique').on(t.organizationId, t.id),
    unique('notifications_idempotency_unique').on(t.organizationId, t.idempotencyKey),
    check(
      'notifications_status_check',
      sql`status in ('pending','sent','failed','suppressed','cancelled')`,
    ),
    check('notifications_channel_check', sql`channel in ('in_app','email','sms','push')`),
    foreignKey({
      columns: [t.organizationId, t.employmentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'notifications_employment_tenant_fk',
    }).onDelete('cascade'),
    index('notifications_inbox_idx').on(t.organizationId, t.employmentId, t.status),
    index('notifications_due_idx').on(t.status, t.scheduledFor),
    index('notifications_claimable_idx').on(
      t.organizationId,
      t.status,
      t.scheduledFor,
      t.lockedUntil,
    ),
  ],
)

/**
 * One row per (person, category, channel). Absent means "use the default",
 * which is on - people should not have to opt in to being told about their own
 * work.
 *
 * `category` here is an announcement category key or a notification category;
 * both are strings so a tenant adding a category does not need a migration.
 */
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    employmentId: uuid('employment_id').notNull(),
    category: text('category').notNull(),
    channel: text('channel').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('notification_preferences_org_id_unique').on(t.organizationId, t.id),
    unique('notification_preferences_unique').on(
      t.organizationId,
      t.employmentId,
      t.category,
      t.channel,
    ),
    check(
      'notification_preferences_channel_check',
      sql`channel in ('in_app','email','sms','push')`,
    ),
    foreignKey({
      columns: [t.organizationId, t.employmentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'notification_preferences_employment_tenant_fk',
    }).onDelete('cascade'),
    index('notification_preferences_employment_idx').on(t.organizationId, t.employmentId),
  ],
)

/**
 * Per-person delivery settings: quiet hours and the timezone they are measured
 * in.
 *
 * The timezone is stored on the person rather than read from their location,
 * because the two genuinely differ - a district manager covering three sites,
 * or somebody who commutes across a zone boundary. It DEFAULTS to their home
 * location's timezone, which is what `resolveTimezone` does when the column is
 * NULL, so nobody has to set it for it to be right.
 */
export const notificationSettings = pgTable(
  'notification_settings',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    employmentId: uuid('employment_id').notNull(),

    quietHoursEnabled: boolean('quiet_hours_enabled').notNull().default(false),
    /** Minutes from midnight. Start may be greater than end (overnight). */
    quietHoursStartMinute: integer('quiet_hours_start_minute')
      .notNull()
      .default(22 * 60),
    quietHoursEndMinute: integer('quiet_hours_end_minute')
      .notNull()
      .default(7 * 60),
    /** IANA zone. NULL means "follow my home location". */
    timezone: text('timezone'),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('notification_settings_org_id_unique').on(t.organizationId, t.id),
    unique('notification_settings_employment_unique').on(t.organizationId, t.employmentId),
    check('notification_settings_start_range', sql`quiet_hours_start_minute between 0 and 1439`),
    check('notification_settings_end_range', sql`quiet_hours_end_minute between 0 and 1439`),
    foreignKey({
      columns: [t.organizationId, t.employmentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'notification_settings_employment_tenant_fk',
    }).onDelete('cascade'),
  ],
)
