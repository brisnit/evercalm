import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { organizations } from '@/modules/org/schema'

/**
 * APPEND-ONLY AUDIT.
 *
 * UPDATE and DELETE are revoked from the application runtime role at the
 * database level (see the migration), so a compromised application cannot
 * rewrite history - only the migration role can, and it never serves a
 * request.
 *
 * `organization_id` is nullable: identity events such as sign-in happen
 * before any organization context exists. Those rows are platform-scoped and
 * are invisible to every tenant, because the RLS policy matches on equality
 * and NULL never equals a tenant id.
 */

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),

    /** 'user' | 'system' | 'support' - who caused this. */
    actorType: text('actor_type').notNull().default('user'),
    actorUserId: text('actor_user_id'),
    actorEmploymentId: uuid('actor_employment_id'),
    actorLabel: text('actor_label'),

    /** Dotted action name, e.g. 'location.created', 'role_grant.granted'. */
    action: text('action').notNull(),
    subjectType: text('subject_type'),
    subjectId: text('subject_id'),
    locationId: uuid('location_id'),

    /** Human-readable one-liner for the audit log UI. */
    summary: text('summary').notNull(),
    /** Structured detail. Must never contain sensitive employee fields. */
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),

    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_events_org_created_idx').on(t.organizationId, t.createdAt),
    index('audit_events_action_idx').on(t.organizationId, t.action),
    index('audit_events_subject_idx').on(t.organizationId, t.subjectType, t.subjectId),
  ],
)
