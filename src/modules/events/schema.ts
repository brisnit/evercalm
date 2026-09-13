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

/**
 * EVENTS - a deliberately small foundation.
 *
 * Announcements constantly refer to something happening at a time: a large
 * party on Saturday, a continuing-education day, an inspection. Without a
 * record for that, every one of those becomes prose that nothing can sort,
 * remind about, or put on a schedule later.
 *
 * SCOPE, and what is deferred. This slice ships the record, a simple list, and
 * the link from an announcement. It does NOT ship a calendar grid, recurrence,
 * RSVP, attendance, invitations, or reminders of its own - those belong with
 * scheduling in Slice 4, where shifts already own the calendar surface.
 * Building a second calendar here would be a thing to throw away.
 *
 * The schema is shaped so none of that needs a migration to arrive: an event
 * is already tenant-scoped, location-aware, and time-bounded, and `kind`
 * distinguishes an operational note from a real event without a new table.
 */

export const EVENT_KINDS = [
  /** A booking or service period worth planning around: a 40-top at 7pm. */
  'large_party',
  /** Training, continuing education, a certification day. */
  'training',
  /** An inspection, audit, or visit. */
  'inspection',
  /** A promotion, launch, or seasonal push. */
  'promotion',
  /** Anything else the tenant wants on the list. */
  'general',
] as const
export type EventKind = (typeof EVENT_KINDS)[number]

export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** NULL means the event is organization-wide rather than at one site. */
    locationId: uuid('location_id'),

    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    kind: text('kind').notNull().default('general'),

    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    allDay: boolean('all_day').notNull().default(false),

    /** Operational detail for the floor: "12 guests, allergy - shellfish". */
    notes: text('notes').notNull().default(''),

    createdByEmploymentId: uuid('created_by_employment_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    unique('events_org_id_unique').on(t.organizationId, t.id),
    check(
      'events_kind_check',
      sql`kind in ('large_party','training','inspection','promotion','general')`,
    ),
    check('events_end_after_start', sql`ends_at is null or ends_at >= starts_at`),
    foreignKey({
      columns: [t.organizationId, t.locationId],
      foreignColumns: [locations.organizationId, locations.id],
      name: 'events_location_tenant_fk',
    }).onDelete('cascade'),
    index('events_org_start_idx').on(t.organizationId, t.startsAt),
  ],
)
