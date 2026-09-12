import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { locations, organizations } from '@/modules/org/schema'
import { employments } from '@/modules/people/schema'

/**
 * ACCESS CONTROL.
 *
 * Roles are org-owned rows seeded from the code presets, so a customer can
 * rename a role or adjust its capabilities without affecting other tenants.
 * The capability strings themselves live in code (src/server/authz).
 *
 * `role_grants` is what makes "General Manager at Riverside, Server at
 * Downtown" expressible: a grant is scoped either to the whole organization
 * or to one specific location.
 */

export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    /** Seeded from a preset. Customers may still edit it. */
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('roles_org_id_unique').on(t.organizationId, t.id),
    unique('roles_org_key_unique').on(t.organizationId, t.key),
    index('roles_org_idx').on(t.organizationId),
  ],
)

export const roleCapabilities = pgTable(
  'role_capabilities',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id').notNull(),
    /** A key from the code registry. Validated on write, not by a FK. */
    capability: text('capability').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('role_capabilities_unique').on(t.organizationId, t.roleId, t.capability),
    foreignKey({
      columns: [t.organizationId, t.roleId],
      foreignColumns: [roles.organizationId, roles.id],
      name: 'role_capabilities_role_tenant_fk',
    }).onDelete('cascade'),
    index('role_capabilities_org_idx').on(t.organizationId),
  ],
)

export const roleGrants = pgTable(
  'role_grants',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    employmentId: uuid('employment_id').notNull(),
    roleId: uuid('role_id').notNull(),
    /** 'org' applies everywhere in the tenant; 'location' to one site only. */
    scope: text('scope').notNull(),
    locationId: uuid('location_id'),
    grantedByEmploymentId: uuid('granted_by_employment_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.employmentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'role_grants_employment_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.organizationId, t.roleId],
      foreignColumns: [roles.organizationId, roles.id],
      name: 'role_grants_role_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.organizationId, t.locationId],
      foreignColumns: [locations.organizationId, locations.id],
      name: 'role_grants_location_tenant_fk',
    }).onDelete('cascade'),
    // A location grant must name a location; an org grant must not.
    // Enforced by the database so the invariant cannot be bypassed in code.
    check(
      'role_grants_scope_check',
      sql`(scope = 'org' and location_id is null) or (scope = 'location' and location_id is not null)`,
    ),
    index('role_grants_org_idx').on(t.organizationId),
    index('role_grants_employment_idx').on(t.organizationId, t.employmentId),
  ],
)
