import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { users } from '@/modules/identity/schema'
import { supportCases } from '@/modules/support/schema'

/*
 * EVERCALM-ONLY TABLES - RESTRICTED.
 *
 * No organization_id and no tenant policy, because they are not any
 * customer's data:
 *
 *   platform_staff          who at EverCalm may use the team dashboard
 *   support_internal_notes  notes customers must never see. The runtime role
 *                           holds no privileges on this table at all; staff
 *                           reach it only through SECURITY DEFINER functions.
 *   worker_runs             one row per background worker tick
 *
 * Importing this module is restricted by eslint to the database layer and
 * the authentication adapter, exactly like the identity tables. Mirrored by
 * drizzle/0019_launch_readiness.sql.
 */

export const platformStaff = pgTable('platform_staff', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  displayName: text('display_name').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const supportInternalNotes = pgTable('support_internal_notes', {
  id: uuid('id').primaryKey(),
  caseId: uuid('case_id')
    .notNull()
    .references(() => supportCases.id, { onDelete: 'cascade' }),
  authorStaffUserId: text('author_staff_user_id').notNull(),
  authorLabel: text('author_label').notNull(),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const workerRuns = pgTable(
  'worker_runs',
  {
    id: uuid('id').primaryKey(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }).notNull(),
    organizations: integer('organizations').notNull().default(0),
    counters: jsonb('counters').$type<Record<string, number>>().notNull().default({}),
    errorCount: integer('error_count').notNull().default(0),
    errors: jsonb('errors')
      .$type<{ organizationId: string | null; step: string; message: string }[]>()
      .notNull()
      .default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('worker_runs_finished_idx').on(t.finishedAt)],
)

/** Application rate-limit windows, shared by every instance. Keys are hashes. */
export const appRateLimits = pgTable(
  'app_rate_limits',
  {
    key: text('key').primaryKey(),
    windowStartedAt: timestamp('window_started_at', { withTimezone: true }).notNull(),
    count: integer('count').notNull(),
  },
  (t) => [
    check('app_rate_limits_count_check', sql`${t.count} >= 1`),
    index('app_rate_limits_window_idx').on(t.windowStartedAt),
  ],
)
