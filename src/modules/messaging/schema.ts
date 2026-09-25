import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { organizations } from '@/modules/org/schema'
import { employments } from '@/modules/people/schema'

/**
 * MESSAGING - channels and direct messages.
 *
 * Announcements already exist and are a different thing: one person publishes,
 * everyone receives, and receipts matter. This module is the other half of
 * round 2's communication brief - ongoing conversation.
 *
 * TWO CHANNELS, NOT A CHANNEL PRODUCT. Round 2 is explicit: at most two custom
 * channels per organization. That ceiling is a product decision, not a form
 * validation, so it is enforced in the service and backed here by the uniqueness
 * of a channel's name; a team that wants twenty rooms wants Slack, and the
 * whole point of this surface is that a shift lead can read all of it between
 * two tables.
 *
 * A DIRECT THREAD IS A PAIR, not a group. Storing the pair ordered - the
 * smaller uuid first, enforced by a check constraint - gives "the thread
 * between these two people" a single row and a unique index, so opening a
 * conversation is idempotent under a double tap.
 */

export const CHANNEL_AUDIENCES = ['managers', 'everyone'] as const
export type ChannelAudience = (typeof CHANNEL_AUDIENCES)[number]

export const channels = pgTable(
  'channels',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    purpose: text('purpose'),
    /** Who can read and post: managers only, or the whole organization. */
    audience: text('audience').notNull(),
    createdByEmploymentId: uuid('created_by_employment_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    unique('channels_org_id_unique').on(t.organizationId, t.id),
    unique('channels_name_unique').on(t.organizationId, t.name),
    check('channels_audience_check', sql`${t.audience} in ('managers', 'everyone')`),
    foreignKey({
      columns: [t.organizationId, t.createdByEmploymentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'channels_created_by_tenant_fk',
    }),
    index('channels_org_idx').on(t.organizationId, t.archivedAt),
  ],
)

export const channelMessages = pgTable(
  'channel_messages',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id').notNull(),
    authorEmploymentId: uuid('author_employment_id').notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.channelId],
      foreignColumns: [channels.organizationId, channels.id],
      name: 'channel_messages_channel_tenant_fk',
    }),
    foreignKey({
      columns: [t.organizationId, t.authorEmploymentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'channel_messages_author_tenant_fk',
    }),
    index('channel_messages_channel_idx').on(t.organizationId, t.channelId, t.createdAt),
  ],
)

export const directThreads = pgTable(
  'direct_threads',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** The smaller of the two employment ids, so a pair has exactly one row. */
    participantOneId: uuid('participant_one_id').notNull(),
    participantTwoId: uuid('participant_two_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
  },
  (t) => [
    unique('direct_threads_org_id_unique').on(t.organizationId, t.id),
    unique('direct_threads_pair_unique').on(
      t.organizationId,
      t.participantOneId,
      t.participantTwoId,
    ),
    check('direct_threads_ordered_check', sql`${t.participantOneId} < ${t.participantTwoId}`),
    foreignKey({
      columns: [t.organizationId, t.participantOneId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'direct_threads_one_tenant_fk',
    }),
    foreignKey({
      columns: [t.organizationId, t.participantTwoId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'direct_threads_two_tenant_fk',
    }),
    index('direct_threads_recent_idx').on(t.organizationId, t.lastMessageAt),
  ],
)

export const directMessages = pgTable(
  'direct_messages',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    threadId: uuid('thread_id').notNull(),
    authorEmploymentId: uuid('author_employment_id').notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** When the other participant read it. A thread has exactly one of those. */
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.threadId],
      foreignColumns: [directThreads.organizationId, directThreads.id],
      name: 'direct_messages_thread_tenant_fk',
    }),
    foreignKey({
      columns: [t.organizationId, t.authorEmploymentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'direct_messages_author_tenant_fk',
    }),
    index('direct_messages_thread_idx').on(t.organizationId, t.threadId, t.createdAt),
  ],
)
