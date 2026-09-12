import { sql } from 'drizzle-orm'
import {
  check,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { locations, organizations } from '@/modules/org/schema'
import { users } from '@/modules/identity/schema'

/**
 * EMPLOYMENTS - the tenant-scoped person.
 *
 * Every organization-owned row in EverCalm references employment_id, never
 * user_id. This is the backbone of tenant isolation: a global user has one
 * employment per organization they work for, and all org data hangs off the
 * employment.
 *
 * SENSITIVE FIELDS are marked below. They are gated behind the
 * `people.view_sensitive` capability, which General Managers do NOT hold.
 * They are also in the logger's redaction list.
 */

export const EMPLOYMENT_STATUSES = ['invited', 'active', 'suspended', 'separated'] as const
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number]

export const employments = pgTable(
  'employments',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),

    displayName: text('display_name').notNull(),
    employeeNumber: text('employee_number'),
    status: text('status').notNull().default('invited'),

    /** Free text, set by the employer. Distinct from job ROLES, which drive scheduling. */
    jobTitle: text('job_title'),
    /** Who this person reports to. Tenant-scoped, and cannot point at another org. */
    managerEmploymentId: uuid('manager_employment_id'),

    homeLocationId: uuid('home_location_id'),

    hiredOn: date('hired_on'),
    separatedOn: date('separated_on'),

    // --- sensitive: requires people.view_sensitive -------------------------
    email: text('email'),
    phone: text('phone'),
    dateOfBirth: date('date_of_birth'),
    emergencyContactName: text('emergency_contact_name'),
    emergencyContactPhone: text('emergency_contact_phone'),
    // ----------------------------------------------------------------------

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    unique('employments_org_id_unique').on(t.organizationId, t.id),
    // One employment per person per organization.
    unique('employments_org_user_unique').on(t.organizationId, t.userId),
    // Tenant-aware FK: the home location must belong to the SAME organization.
    foreignKey({
      columns: [t.organizationId, t.homeLocationId],
      foreignColumns: [locations.organizationId, locations.id],
      name: 'employments_home_location_tenant_fk',
    }),
    // The manager must belong to the SAME organization. Declared against this
    // table's own composite key, so a cross-tenant reporting line is
    // structurally impossible.
    foreignKey({
      columns: [t.organizationId, t.managerEmploymentId],
      foreignColumns: [t.organizationId, t.id],
      name: 'employments_manager_tenant_fk',
    }),
    // A person cannot be their own manager. Deeper cycles are prevented in
    // the service, since SQL cannot express that cheaply.
    check(
      'employments_manager_not_self',
      sql`manager_employment_id is null or manager_employment_id <> id`,
    ),
    check('employments_status_check', sql`status in ('invited','active','suspended','separated')`),
    index('employments_org_idx').on(t.organizationId),
    index('employments_user_idx').on(t.userId),
  ],
)

/** Staff who work across more than one site. */
export const employmentLocations = pgTable(
  'employment_locations',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    employmentId: uuid('employment_id').notNull(),
    locationId: uuid('location_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('employment_locations_unique').on(t.organizationId, t.employmentId, t.locationId),
    foreignKey({
      columns: [t.organizationId, t.employmentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'employment_locations_employment_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.organizationId, t.locationId],
      foreignColumns: [locations.organizationId, locations.id],
      name: 'employment_locations_location_tenant_fk',
    }).onDelete('cascade'),
    index('employment_locations_org_idx').on(t.organizationId),
  ],
)

/**
 * PROFESSIONAL CREDENTIALS.
 *
 * Deliberately generic: a cosmetology licence, a food handler card, a CPR
 * certification, a driving licence. The schema knows only that a credential
 * has an issuer, an identifier, and usually an expiry - so the salon tenant
 * can track state licensure without the platform hard-coding either industry.
 *
 * Expiry is the reason this exists in Slice 2 rather than waiting for the
 * certification work in Phase 2: a stylist whose licence lapses cannot legally
 * work, and that is an onboarding and readiness fact, not a training fact.
 */
export const employmentCredentials = pgTable(
  'employment_credentials',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    employmentId: uuid('employment_id').notNull(),

    name: text('name').notNull(),
    issuingAuthority: text('issuing_authority'),
    /** Licence or certificate number. Treated as sensitive. */
    identifier: text('identifier'),
    issuedOn: date('issued_on'),
    /** Null for credentials that do not expire. */
    expiresOn: date('expires_on'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedByEmploymentId: uuid('verified_by_employment_id'),
    note: text('note'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    unique('employment_credentials_org_id_unique').on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.employmentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'employment_credentials_employment_tenant_fk',
    }).onDelete('cascade'),
    index('employment_credentials_expiry_idx').on(t.organizationId, t.expiresOn),
  ],
)

/**
 * SEPARATIONS.
 *
 * Ending someone's employment is the highest-consequence action in the
 * product, so it is a RECORD with a lifecycle rather than a status flip.
 *
 *   draft -> pending_approval -> approved -> completed
 *
 * Everything before `completed` is reversible: the employment stays intact and
 * a separation can be cancelled. Only completing it revokes access, and only a
 * SECOND named human holding organization-wide `people.separate` can approve -
 * the requester may never approve their own request.
 *
 * Nothing in EverCalm decides this. There is no code path that creates or
 * advances a separation without a named human actor.
 */
export const SEPARATION_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'completed',
  'cancelled',
] as const
export type SeparationStatus = (typeof SEPARATION_STATUSES)[number]

export const separations = pgTable(
  'separations',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    employmentId: uuid('employment_id').notNull(),

    /**
     * A neutral, configurable category. EverCalm supplies no jurisdiction
     * specific guidance and draws no legal conclusion from this value.
     */
    reasonCategory: text('reason_category').notNull(),
    /** Required free text. A separation with no stated reason cannot be filed. */
    reason: text('reason').notNull(),
    effectiveOn: date('effective_on').notNull(),
    status: text('status').notNull().default('draft'),

    requestedByEmploymentId: uuid('requested_by_employment_id').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    /** Must differ from the requester. Enforced in the service and by a check. */
    approvedByEmploymentId: uuid('approved_by_employment_id'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledByEmploymentId: uuid('cancelled_by_employment_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('separations_org_id_unique').on(t.organizationId, t.id),
    check(
      'separations_status_check',
      sql`status in ('draft','pending_approval','approved','completed','cancelled')`,
    ),
    // The two-person rule, enforced by the database as well as the service.
    check(
      'separations_two_person_rule',
      sql`approved_by_employment_id is null or approved_by_employment_id <> requested_by_employment_id`,
    ),
    foreignKey({
      columns: [t.organizationId, t.employmentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'separations_employment_tenant_fk',
    }).onDelete('cascade'),
    index('separations_org_status_idx').on(t.organizationId, t.status),
  ],
)
