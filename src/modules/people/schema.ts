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
