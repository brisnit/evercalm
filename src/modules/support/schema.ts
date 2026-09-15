import { sql } from 'drizzle-orm'
import {
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

/*
 * SUPPORT CASES, as the customer owns them.
 *
 * Tenant tables under RLS. A case is never deleted; its messages are
 * append-only. EverCalm's internal notes are NOT here: they live in
 * `support_internal_notes` (server/db/platform-schema.ts), a table the runtime
 * role holds no privileges on, so no customer query can ever reach one.
 */

export const SUPPORT_CATEGORIES = [
  'question',
  'problem',
  'billing',
  'account',
  'data_request',
  'feedback',
] as const
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number]
export const SUPPORT_SEVERITIES = ['low', 'normal', 'high', 'urgent'] as const
export type SupportSeverity = (typeof SUPPORT_SEVERITIES)[number]
export const SUPPORT_STATUSES = ['open', 'in_progress', 'waiting_on_customer', 'resolved'] as const
export type SupportStatus = (typeof SUPPORT_STATUSES)[number]

export const supportCases = pgTable(
  'support_cases',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    reference: text('reference').notNull(),
    category: text('category').notNull(),
    severity: text('severity').notNull().default('normal'),
    status: text('status').notNull().default('open'),
    subject: text('subject').notNull(),
    description: text('description').notNull(),
    createdByEmploymentId: uuid('created_by_employment_id').notNull(),
    createdByLabel: text('created_by_label').notNull(),
    assignedStaffUserId: text('assigned_staff_user_id'),
    assignedStaffLabel: text('assigned_staff_label').notNull().default(''),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    reopenedCount: integer('reopened_count').notNull().default(0),
    lastCustomerActivityAt: timestamp('last_customer_activity_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastEvercalmActivityAt: timestamp('last_evercalm_activity_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('support_cases_org_id_unique').on(t.organizationId, t.id),
    unique('support_cases_reference_unique').on(t.organizationId, t.reference),
    check(
      'support_cases_category_check',
      sql`${t.category} in ('question','problem','billing','account','data_request','feedback')`,
    ),
    check('support_cases_severity_check', sql`${t.severity} in ('low','normal','high','urgent')`),
    check(
      'support_cases_status_check',
      sql`${t.status} in ('open','in_progress','waiting_on_customer','resolved')`,
    ),
    check(
      'support_cases_resolved_check',
      sql`(${t.status} = 'resolved') = (${t.resolvedAt} is not null)`,
    ),
    check(
      'support_cases_text_check',
      sql`length(trim(${t.subject})) > 0 and length(trim(${t.description})) > 0`,
    ),
    foreignKey({
      columns: [t.organizationId, t.createdByEmploymentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'support_cases_creator_tenant_fk',
    }),
    index('support_cases_status_idx').on(t.organizationId, t.status, t.updatedAt),
  ],
)

export const supportCaseMessages = pgTable(
  'support_case_messages',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    caseId: uuid('case_id').notNull(),
    authorType: text('author_type').notNull(),
    authorEmploymentId: uuid('author_employment_id'),
    authorLabel: text('author_label').notNull(),
    body: text('body').notNull().default(''),
    statusFrom: text('status_from'),
    statusTo: text('status_to'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('support_case_messages_author_check', sql`${t.authorType} in ('customer','evercalm')`),
    check(
      'support_case_messages_content_check',
      sql`length(trim(${t.body})) > 0 or ${t.statusTo} is not null`,
    ),
    foreignKey({
      columns: [t.organizationId, t.caseId],
      foreignColumns: [supportCases.organizationId, supportCases.id],
      name: 'support_case_messages_case_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.organizationId, t.authorEmploymentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'support_case_messages_author_tenant_fk',
    }),
    index('support_case_messages_case_idx').on(t.organizationId, t.caseId, t.createdAt),
  ],
)
