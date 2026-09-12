import { index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'

/**
 * TENANT ROOT.
 *
 * `organizations.id` is the value carried in app.organization_id and matched
 * by every tenant RLS policy.
 *
 * `jurisdiction` is metadata only. It lets a future slice attach
 * jurisdiction-specific policy content that qualified humans have reviewed.
 * No legal logic is derived from it, and none may be added without approval.
 */

export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    industry: text('industry').notNull(),
    /** IANA timezone, e.g. America/Los_Angeles. Locations may override. */
    timezone: text('timezone').notNull().default('America/Los_Angeles'),
    /** Metadata for future reviewed policy content. Carries no legal logic. */
    jurisdiction: text('jurisdiction'),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [unique('organizations_slug_unique').on(t.slug)],
)

export const locations = pgTable(
  'locations',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Locations keep their own timezone: a business date is local to the site. */
    timezone: text('timezone').notNull().default('America/Los_Angeles'),
    addressLine1: text('address_line1'),
    city: text('city'),
    region: text('region'),
    postalCode: text('postal_code'),
    country: text('country').notNull().default('US'),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    // Composite-FK target: lets children reference (organization_id, id)
    // so a child can never point at another tenant's location.
    unique('locations_org_id_unique').on(t.organizationId, t.id),
    index('locations_org_idx').on(t.organizationId),
  ],
)
