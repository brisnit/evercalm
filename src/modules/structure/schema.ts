import {
  boolean,
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

/**
 * ORGANIZATIONAL STRUCTURE.
 *
 * Deliberately generic. A restaurant calls a work position a "station" at the
 * bar; a salon calls it a "chair"; a warehouse calls it a "pick zone". The
 * schema names the CONCEPT, and each tenant supplies its own vocabulary
 * through the rows it creates - which is why the salon demo tenant reads
 * nothing like the restaurant one despite sharing every table.
 */

export const departments = pgTable(
  'departments',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    unique('departments_org_id_unique').on(t.organizationId, t.id),
    unique('departments_org_name_unique').on(t.organizationId, t.name),
    index('departments_org_idx').on(t.organizationId),
  ],
)

/**
 * A job role is what someone DOES - Server, Line Cook, Stylist, Barber.
 * It drives training assignment and, later, scheduling eligibility.
 * Distinct from `job_title`, which is free text on the employment.
 */
export const jobRoles = pgTable(
  'job_roles',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    departmentId: uuid('department_id'),
    name: text('name').notNull(),
    description: text('description'),
    /** Token name from the design system, never a raw hex value. */
    colorToken: text('color_token').notNull().default('violet'),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    unique('job_roles_org_id_unique').on(t.organizationId, t.id),
    unique('job_roles_org_name_unique').on(t.organizationId, t.name),
    foreignKey({
      columns: [t.organizationId, t.departmentId],
      foreignColumns: [departments.organizationId, departments.id],
      name: 'job_roles_department_tenant_fk',
    }),
    index('job_roles_org_idx').on(t.organizationId),
  ],
)

export const teams = pgTable(
  'teams',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    departmentId: uuid('department_id'),
    locationId: uuid('location_id'),
    name: text('name').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    unique('teams_org_id_unique').on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.departmentId],
      foreignColumns: [departments.organizationId, departments.id],
      name: 'teams_department_tenant_fk',
    }),
    foreignKey({
      columns: [t.organizationId, t.locationId],
      foreignColumns: [locations.organizationId, locations.id],
      name: 'teams_location_tenant_fk',
    }),
    index('teams_org_idx').on(t.organizationId),
  ],
)

/**
 * A work position at a location. "Station" is the schema's neutral term; the
 * salon tenant fills these with chairs and treatment rooms, the restaurant
 * with the bar and host stand.
 */
export const stations = pgTable(
  'stations',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id').notNull(),
    jobRoleId: uuid('job_role_id'),
    name: text('name').notNull(),
    description: text('description'),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    unique('stations_org_id_unique').on(t.organizationId, t.id),
    unique('stations_location_name_unique').on(t.organizationId, t.locationId, t.name),
    foreignKey({
      columns: [t.organizationId, t.locationId],
      foreignColumns: [locations.organizationId, locations.id],
      name: 'stations_location_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.organizationId, t.jobRoleId],
      foreignColumns: [jobRoles.organizationId, jobRoles.id],
      name: 'stations_job_role_tenant_fk',
    }),
    index('stations_org_idx').on(t.organizationId),
  ],
)

export const employmentJobRoles = pgTable(
  'employment_job_roles',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    employmentId: uuid('employment_id').notNull(),
    jobRoleId: uuid('job_role_id').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('employment_job_roles_unique').on(t.organizationId, t.employmentId, t.jobRoleId),
    foreignKey({
      columns: [t.organizationId, t.employmentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'employment_job_roles_employment_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.organizationId, t.jobRoleId],
      foreignColumns: [jobRoles.organizationId, jobRoles.id],
      name: 'employment_job_roles_role_tenant_fk',
    }).onDelete('cascade'),
    index('employment_job_roles_org_idx').on(t.organizationId),
  ],
)

/**
 * Team membership.
 *
 * Teams already existed as a structural unit, but nobody belonged to one -
 * which made "tell the closing team" impossible to express. This is the
 * missing edge, added in Slice 3 because announcement targeting is the first
 * feature that needs to name a group of people who are not simply everyone
 * holding a job role.
 */
export const employmentTeams = pgTable(
  'employment_teams',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    employmentId: uuid('employment_id').notNull(),
    teamId: uuid('team_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('employment_teams_unique').on(t.organizationId, t.employmentId, t.teamId),
    foreignKey({
      columns: [t.organizationId, t.employmentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'employment_teams_employment_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.organizationId, t.teamId],
      foreignColumns: [teams.organizationId, teams.id],
      name: 'employment_teams_team_tenant_fk',
    }).onDelete('cascade'),
    index('employment_teams_org_idx').on(t.organizationId),
  ],
)

/**
 * Company values and operating standards.
 *
 * `kind` separates aspirational values from concrete standards, because they
 * are used differently: values appear in onboarding and culture material,
 * standards are what daily operations are measured against.
 */
export const organizationValues = pgTable(
  'organization_values',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull().default('value'),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    unique('organization_values_org_id_unique').on(t.organizationId, t.id),
    index('organization_values_org_idx').on(t.organizationId),
  ],
)
