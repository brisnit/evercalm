import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { organizations } from '@/modules/org/schema'
import { employments } from '@/modules/people/schema'
import { roles } from '@/modules/access/schema'

/**
 * INVITATIONS.
 *
 * Security properties this table exists to support:
 *
 *  - **Only a hash is stored.** `token_hash` is a SHA-256 of the single-use
 *    token. The token itself appears once, in the emailed link. A database
 *    dump therefore does not yield working invitation links.
 *  - **Single use.** `accepted_at` is set in the same transaction that creates
 *    the employment, so a replayed link finds an already-accepted invitation.
 *  - **Expiry.** `expires_at` is checked on every lookup.
 *  - **Revocable and resendable.** Resending issues a NEW token and
 *    invalidates the old hash, so a forwarded old link stops working.
 *  - **No enumeration.** Nothing in this table is queryable by an
 *    unauthenticated caller except by presenting a valid token hash.
 *
 * The intended access is stored as data rather than applied immediately:
 * nothing is granted until the person actually accepts.
 */

export const INVITATION_STATUSES = ['pending', 'accepted', 'revoked', 'expired'] as const
export type InvitationStatus = (typeof INVITATION_STATUSES)[number]

export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),

    /** Stored lower-cased. Unique per organization among live invitations. */
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    jobTitle: text('job_title'),

    /** SHA-256 of the single-use token. The token itself is never stored. */
    tokenHash: text('token_hash').notNull(),

    /** Access to grant ON ACCEPTANCE. Nothing is granted before that. */
    roleId: uuid('role_id').notNull(),
    roleScope: text('role_scope').notNull().default('org'),
    scopeLocationId: uuid('scope_location_id'),
    homeLocationId: uuid('home_location_id'),
    /** Location and job-role ids, validated against this tenant on write. */
    locationIds: jsonb('location_ids').$type<string[]>().notNull().default([]),
    jobRoleIds: jsonb('job_role_ids').$type<string[]>().notNull().default([]),

    status: text('status').notNull().default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

    invitedByEmploymentId: uuid('invited_by_employment_id'),
    /**
     * Set when the person already exists as an employment - a bulk import
     * creates the record first. Acceptance then LINKS the identity to that
     * employment instead of creating a second one.
     */
    targetEmploymentId: uuid('target_employment_id'),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedEmploymentId: uuid('accepted_employment_id'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedByEmploymentId: uuid('revoked_by_employment_id'),

    /** How many times a link has been issued, for rate limiting and audit. */
    sendCount: integer('send_count').notNull().default(1),
    lastSentAt: timestamp('last_sent_at', { withTimezone: true }).notNull().defaultNow(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('invitations_org_id_unique').on(t.organizationId, t.id),
    // The hash is globally unique: acceptance looks an invitation up by hash
    // alone, before any tenant context exists.
    unique('invitations_token_hash_unique').on(t.tokenHash),
    check('invitations_status_check', sql`status in ('pending','accepted','revoked','expired')`),
    check(
      'invitations_scope_check',
      sql`(role_scope = 'org' and scope_location_id is null) or (role_scope = 'location' and scope_location_id is not null)`,
    ),
    foreignKey({
      columns: [t.organizationId, t.roleId],
      foreignColumns: [roles.organizationId, roles.id],
      name: 'invitations_role_tenant_fk',
    }),
    foreignKey({
      columns: [t.organizationId, t.invitedByEmploymentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'invitations_invited_by_tenant_fk',
    }),
    foreignKey({
      columns: [t.organizationId, t.targetEmploymentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'invitations_target_employment_tenant_fk',
    }).onDelete('cascade'),
    index('invitations_org_status_idx').on(t.organizationId, t.status),
    index('invitations_org_email_idx').on(t.organizationId, t.email),
  ],
)
