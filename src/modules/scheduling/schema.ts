import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { locations, organizations } from '@/modules/org/schema'
import { employments } from '@/modules/people/schema'
import { jobRoles, stations } from '@/modules/structure/schema'

/*
 * SCHEDULING.
 *
 * Deliberately industry-neutral. A "shift" is a period someone works at a
 * location, optionally for a job role and at a station. A restaurant fills
 * those with Server and Bar; a salon with Stylist and Chair 3. Nothing here
 * knows which.
 *
 * Mirrored exactly by drizzle/0015_scheduling.sql, which also carries what
 * Drizzle cannot express: the exclusion constraint that makes double-booking
 * one person impossible, and the grants that remove DELETE from decision
 * records.
 *
 * Minutes-after-midnight columns are LOCAL wall-clock minutes at the location
 * they apply to (0-1440). Instants are timestamptz. See ./time.ts.
 */

export const AVAILABILITY_PREFERENCES = ['available', 'preferred', 'unavailable'] as const
export type AvailabilityPreference = (typeof AVAILABILITY_PREFERENCES)[number]

export const TIME_OFF_REASONS = ['vacation', 'sick', 'personal', 'family', 'other'] as const
export type TimeOffReason = (typeof TIME_OFF_REASONS)[number]

export const TIME_OFF_STATUSES = ['pending', 'approved', 'denied', 'cancelled'] as const
export type TimeOffStatus = (typeof TIME_OFF_STATUSES)[number]

export const SCHEDULE_STATUSES = ['draft', 'published'] as const
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number]

export const SHIFT_STATUSES = ['active', 'cancelled'] as const
export type ShiftStatus = (typeof SHIFT_STATUSES)[number]

export const CLAIM_STATUSES = ['pending', 'approved', 'declined', 'withdrawn', 'expired'] as const
export type ClaimStatus = (typeof CLAIM_STATUSES)[number]

export const SWAP_KINDS = ['giveaway', 'trade'] as const
export type SwapKind = (typeof SWAP_KINDS)[number]

export const SWAP_STATUSES = [
  'pending_recipient',
  'pending_manager',
  'approved',
  'declined',
  'denied',
  'cancelled',
  'expired',
] as const
export type SwapStatus = (typeof SWAP_STATUSES)[number]

/** A swap that still needs someone to act. */
export const ACTIVE_SWAP_STATUSES: readonly SwapStatus[] = ['pending_recipient', 'pending_manager']

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

/** A recurring weekly window: "Tuesdays 18:00-24:00, unavailable". */
export const availabilityRules = pgTable(
  'availability_rules',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    employmentId: uuid('employment_id').notNull(),
    /** ISO weekday, Monday = 1. */
    weekday: smallint('weekday').notNull(),
    startMinute: integer('start_minute').notNull(),
    endMinute: integer('end_minute').notNull(),
    preference: text('preference').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.employmentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'availability_rules_employment_tenant_fk',
    }).onDelete('cascade'),
    check('availability_rules_weekday_check', sql`${t.weekday} between 1 and 7`),
    check(
      'availability_rules_window_check',
      sql`${t.startMinute} >= 0 and ${t.endMinute} > ${t.startMinute} and ${t.endMinute} <= 1440`,
    ),
    check(
      'availability_rules_preference_check',
      sql`${t.preference} in ('available','preferred','unavailable')`,
    ),
    index('availability_rules_employment_idx').on(t.organizationId, t.employmentId),
  ],
)

/** A dated override. For its date it REPLACES the weekly pattern. */
export const availabilityExceptions = pgTable(
  'availability_exceptions',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    employmentId: uuid('employment_id').notNull(),
    onDate: date('on_date').notNull(),
    /** Both null means the whole day. */
    startMinute: integer('start_minute'),
    endMinute: integer('end_minute'),
    preference: text('preference').notNull(),
    note: text('note').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.employmentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'availability_exceptions_employment_tenant_fk',
    }).onDelete('cascade'),
    check(
      'availability_exceptions_window_check',
      sql`(${t.startMinute} is null and ${t.endMinute} is null) or (${t.startMinute} >= 0 and ${t.endMinute} > ${t.startMinute} and ${t.endMinute} <= 1440)`,
    ),
    check(
      'availability_exceptions_preference_check',
      sql`${t.preference} in ('available','unavailable')`,
    ),
    index('availability_exceptions_employment_idx').on(t.organizationId, t.employmentId, t.onDate),
  ],
)

// ---------------------------------------------------------------------------
// Time off
// ---------------------------------------------------------------------------

export const timeOffRequests = pgTable(
  'time_off_requests',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    employmentId: uuid('employment_id').notNull(),
    /** Inclusive local dates. */
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    /** Set only for part of a single day. */
    startMinute: integer('start_minute'),
    endMinute: integer('end_minute'),
    reason: text('reason').notNull().default('personal'),
    note: text('note').notNull().default(''),
    status: text('status').notNull().default('pending'),
    decidedByEmploymentId: uuid('decided_by_employment_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note').notNull().default(''),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('time_off_requests_org_id_unique').on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.employmentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'time_off_requests_employment_tenant_fk',
    }).onDelete('cascade'),
    check('time_off_requests_dates_check', sql`${t.endsOn} >= ${t.startsOn}`),
    check(
      'time_off_requests_partial_day_check',
      sql`(${t.startMinute} is null and ${t.endMinute} is null) or (${t.startsOn} = ${t.endsOn} and ${t.startMinute} >= 0 and ${t.endMinute} > ${t.startMinute} and ${t.endMinute} <= 1440)`,
    ),
    check(
      'time_off_requests_reason_check',
      sql`${t.reason} in ('vacation','sick','personal','family','other')`,
    ),
    check(
      'time_off_requests_status_check',
      sql`${t.status} in ('pending','approved','denied','cancelled')`,
    ),
    check(
      'time_off_requests_decision_check',
      sql`${t.status} not in ('approved','denied') or ${t.decidedAt} is not null`,
    ),
    index('time_off_requests_employment_idx').on(t.organizationId, t.employmentId, t.startsOn),
    index('time_off_requests_status_idx').on(t.organizationId, t.status),
  ],
)

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/** A reusable shift pattern at one location. */
export const shiftTemplates = pgTable(
  'shift_templates',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id').notNull(),
    name: text('name').notNull(),
    jobRoleId: uuid('job_role_id'),
    stationId: uuid('station_id'),
    startMinute: integer('start_minute').notNull(),
    /** At or before start_minute means the shift ends the next day. */
    endMinute: integer('end_minute').notNull(),
    breakMinutes: integer('break_minutes').notNull().default(0),
    /** ISO weekdays this pattern normally runs. Empty = apply manually. */
    daysOfWeek: smallint('days_of_week')
      .array()
      .notNull()
      .default(sql`'{}'::smallint[]`),
    /** How many people the pattern needs: one shift row per person. */
    headcount: smallint('headcount').notNull().default(1),
    notes: text('notes').notNull().default(''),
    /** The named week this pattern belongs to, if any (round 2, Slotted). */
    templateSetId: uuid('template_set_id'),
    createdByEmploymentId: uuid('created_by_employment_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    unique('shift_templates_org_id_unique').on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.locationId],
      foreignColumns: [locations.organizationId, locations.id],
      name: 'shift_templates_location_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.organizationId, t.jobRoleId],
      foreignColumns: [jobRoles.organizationId, jobRoles.id],
      name: 'shift_templates_job_role_tenant_fk',
    }),
    foreignKey({
      columns: [t.organizationId, t.stationId],
      foreignColumns: [stations.organizationId, stations.id],
      name: 'shift_templates_station_tenant_fk',
    }),
    // A standalone pattern's name is unique per location, as it always was.
    // A pattern inside a named week is unique within that week, so two
    // templates for the same restaurant can both have a "Server · dinner".
    uniqueIndex('shift_templates_location_name_unique')
      .on(t.organizationId, t.locationId, sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} is null and ${t.templateSetId} is null`),
    uniqueIndex('shift_templates_set_name_unique')
      .on(t.organizationId, t.templateSetId, sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} is null and ${t.templateSetId} is not null`),
    check(
      'shift_templates_times_check',
      sql`${t.startMinute} between 0 and 1439 and ${t.endMinute} between 0 and 1439 and ${t.startMinute} <> ${t.endMinute}`,
    ),
    check('shift_templates_break_check', sql`${t.breakMinutes} between 0 and 240`),
    check('shift_templates_headcount_check', sql`${t.headcount} between 1 and 20`),
    check('shift_templates_days_check', sql`${t.daysOfWeek} <@ '{1,2,3,4,5,6,7}'::smallint[]`),
    index('shift_templates_location_idx').on(t.organizationId, t.locationId),
  ],
)

// ---------------------------------------------------------------------------
// Schedules and shifts
// ---------------------------------------------------------------------------

/** One location's week. `week_start` is the local Monday. */
export const schedules = pgTable(
  'schedules',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id').notNull(),
    weekStart: date('week_start').notNull(),
    status: text('status').notNull().default('draft'),
    /** Increments on every publication; notifications are keyed on it. */
    publishedVersion: integer('published_version').notNull().default(0),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedByEmploymentId: uuid('published_by_employment_id'),
    /** Edits made since the last publication, not yet visible to employees. */
    hasUnpublishedChanges: boolean('has_unpublished_changes').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('schedules_org_id_unique').on(t.organizationId, t.id),
    // Target for shifts' (organization, schedule, location) key, so a shift
    // can never sit in a schedule for a different location.
    unique('schedules_org_id_location_unique').on(t.organizationId, t.id, t.locationId),
    unique('schedules_location_week_unique').on(t.organizationId, t.locationId, t.weekStart),
    foreignKey({
      columns: [t.organizationId, t.locationId],
      foreignColumns: [locations.organizationId, locations.id],
      name: 'schedules_location_tenant_fk',
    }).onDelete('cascade'),
    check('schedules_status_check', sql`${t.status} in ('draft','published')`),
    check('schedules_monday_check', sql`extract(isodow from ${t.weekStart}) = 1`),
    check('schedules_published_check', sql`${t.status} = 'draft' or ${t.publishedAt} is not null`),
  ],
)

/**
 * One person-shaped slot of work.
 *
 * TWO COPIES OF THE TRUTH, on purpose. The plain columns are what managers
 * are editing. The `published_*` columns are what employees were last told.
 * Publishing copies one onto the other and notifies exactly the people whose
 * copy changed. An employee never sees a half-finished edit, and a manager
 * never loses track of what the team was actually told.
 */
export const shifts = pgTable(
  'shifts',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    scheduleId: uuid('schedule_id').notNull(),
    locationId: uuid('location_id').notNull(),
    templateId: uuid('template_id'),
    jobRoleId: uuid('job_role_id'),
    stationId: uuid('station_id'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    breakMinutes: integer('break_minutes').notNull().default(0),
    notes: text('notes').notNull().default(''),
    assigneeEmploymentId: uuid('assignee_employment_id'),
    /** Offered to eligible people to claim. Never true while someone is assigned. */
    isOpen: boolean('is_open').notNull().default(false),
    status: text('status').notNull().default('active'),
    /** Bumped on every change; swap and claim approvals check it. */
    version: integer('version').notNull().default(1),

    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedStartsAt: timestamp('published_starts_at', { withTimezone: true }),
    publishedEndsAt: timestamp('published_ends_at', { withTimezone: true }),
    publishedBreakMinutes: integer('published_break_minutes'),
    publishedJobRoleId: uuid('published_job_role_id'),
    publishedStationId: uuid('published_station_id'),
    publishedNotes: text('published_notes'),
    publishedAssigneeEmploymentId: uuid('published_assignee_employment_id'),
    publishedIsOpen: boolean('published_is_open'),
    publishedStatus: text('published_status'),

    createdByEmploymentId: uuid('created_by_employment_id'),
    updatedByEmploymentId: uuid('updated_by_employment_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('shifts_org_id_unique').on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.scheduleId, t.locationId],
      foreignColumns: [schedules.organizationId, schedules.id, schedules.locationId],
      name: 'shifts_schedule_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.organizationId, t.templateId],
      foreignColumns: [shiftTemplates.organizationId, shiftTemplates.id],
      name: 'shifts_template_tenant_fk',
    }),
    foreignKey({
      columns: [t.organizationId, t.jobRoleId],
      foreignColumns: [jobRoles.organizationId, jobRoles.id],
      name: 'shifts_job_role_tenant_fk',
    }),
    foreignKey({
      columns: [t.organizationId, t.stationId],
      foreignColumns: [stations.organizationId, stations.id],
      name: 'shifts_station_tenant_fk',
    }),
    foreignKey({
      columns: [t.organizationId, t.assigneeEmploymentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'shifts_assignee_tenant_fk',
    }),
    foreignKey({
      columns: [t.organizationId, t.publishedAssigneeEmploymentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'shifts_published_assignee_tenant_fk',
    }),
    check('shifts_times_check', sql`${t.endsAt} > ${t.startsAt}`),
    check('shifts_length_check', sql`${t.endsAt} - ${t.startsAt} <= interval '24 hours'`),
    check('shifts_break_check', sql`${t.breakMinutes} between 0 and 240`),
    check('shifts_status_check', sql`${t.status} in ('active','cancelled')`),
    check('shifts_open_check', sql`not (${t.isOpen} and ${t.assigneeEmploymentId} is not null)`),
    check(
      'shifts_published_check',
      sql`(${t.publishedAt} is null) = (${t.publishedStartsAt} is null) and (${t.publishedStatus} is null or ${t.publishedStatus} in ('active','cancelled'))`,
    ),
    index('shifts_location_start_idx').on(t.organizationId, t.locationId, t.startsAt),
    index('shifts_assignee_start_idx').on(t.organizationId, t.assigneeEmploymentId, t.startsAt),
    index('shifts_published_assignee_idx').on(
      t.organizationId,
      t.publishedAssigneeEmploymentId,
      t.publishedStartsAt,
    ),
    index('shifts_schedule_idx').on(t.organizationId, t.scheduleId),
  ],
)

// ---------------------------------------------------------------------------
// Open shifts and swaps
// ---------------------------------------------------------------------------

export const openShiftClaims = pgTable(
  'open_shift_claims',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    shiftId: uuid('shift_id').notNull(),
    employmentId: uuid('employment_id').notNull(),
    status: text('status').notNull().default('pending'),
    note: text('note').notNull().default(''),
    decidedByEmploymentId: uuid('decided_by_employment_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.shiftId],
      foreignColumns: [shifts.organizationId, shifts.id],
      name: 'open_shift_claims_shift_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.organizationId, t.employmentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'open_shift_claims_employment_tenant_fk',
    }).onDelete('cascade'),
    uniqueIndex('open_shift_claims_pending_unique')
      .on(t.organizationId, t.shiftId, t.employmentId)
      .where(sql`${t.status} = 'pending'`),
    check(
      'open_shift_claims_status_check',
      sql`${t.status} in ('pending','approved','declined','withdrawn','expired')`,
    ),
    index('open_shift_claims_shift_idx').on(t.organizationId, t.shiftId),
    index('open_shift_claims_employment_idx').on(t.organizationId, t.employmentId),
  ],
)

/**
 * A request to hand a shift to a named colleague (giveaway) or exchange it
 * for one of theirs (trade). The colleague accepts, then a manager approves.
 *
 * `shift_version` records the shift as it was when asked. If the shift has
 * been changed by the time a manager approves, the approval is refused - the
 * colleague agreed to take THAT shift, not whatever it has since become.
 */
export const shiftSwapRequests = pgTable(
  'shift_swap_requests',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    shiftId: uuid('shift_id').notNull(),
    shiftVersion: integer('shift_version').notNull(),
    requesterEmploymentId: uuid('requester_employment_id').notNull(),
    recipientEmploymentId: uuid('recipient_employment_id').notNull(),
    recipientShiftId: uuid('recipient_shift_id'),
    recipientShiftVersion: integer('recipient_shift_version'),
    status: text('status').notNull().default('pending_recipient'),
    note: text('note').notNull().default(''),
    recipientRespondedAt: timestamp('recipient_responded_at', { withTimezone: true }),
    decidedByEmploymentId: uuid('decided_by_employment_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.shiftId],
      foreignColumns: [shifts.organizationId, shifts.id],
      name: 'shift_swap_requests_shift_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.organizationId, t.recipientShiftId],
      foreignColumns: [shifts.organizationId, shifts.id],
      name: 'shift_swap_requests_recipient_shift_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.organizationId, t.requesterEmploymentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'shift_swap_requests_requester_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.organizationId, t.recipientEmploymentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'shift_swap_requests_recipient_tenant_fk',
    }).onDelete('cascade'),
    // One live request per shift, on either side of a trade.
    uniqueIndex('shift_swap_requests_active_shift_unique')
      .on(t.organizationId, t.shiftId)
      .where(sql`${t.status} in ('pending_recipient','pending_manager')`),
    uniqueIndex('shift_swap_requests_active_recipient_shift_unique')
      .on(t.organizationId, t.recipientShiftId)
      .where(
        sql`${t.status} in ('pending_recipient','pending_manager') and ${t.recipientShiftId} is not null`,
      ),
    check('shift_swap_requests_kind_check', sql`${t.kind} in ('giveaway','trade')`),
    check(
      'shift_swap_requests_trade_check',
      sql`(${t.kind} = 'trade') = (${t.recipientShiftId} is not null)`,
    ),
    check(
      'shift_swap_requests_people_check',
      sql`${t.requesterEmploymentId} <> ${t.recipientEmploymentId}`,
    ),
    check(
      'shift_swap_requests_status_check',
      sql`${t.status} in ('pending_recipient','pending_manager','approved','declined','denied','cancelled','expired')`,
    ),
    index('shift_swap_requests_requester_idx').on(t.organizationId, t.requesterEmploymentId),
    index('shift_swap_requests_recipient_idx').on(t.organizationId, t.recipientEmploymentId),
    index('shift_swap_requests_status_idx').on(t.organizationId, t.status),
  ],
)

// ---------------------------------------------------------------------------
// SLOTTED (round 2): a named week, the review of each day, the overrides a
// manager took responsibility for, and call-outs.
// ---------------------------------------------------------------------------

/**
 * A named week: which days are open, the break rules, and - through
 * `shiftTemplates.templateSetId` - the demand patterns that belong to it.
 *
 * "Describe demand once" is the whole Slotted idea. A manager builds this in a
 * wizard one time, and every future week starts from it with the slots already
 * laid out.
 */
export const scheduleTemplates = pgTable(
  'schedule_templates',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id').notNull(),
    name: text('name').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    /** ISO weekdays the business is open. A closed day never gets slots. */
    openDays: smallint('open_days')
      .array()
      .notNull()
      .default(sql`'{1,2,3,4,5,6,7}'::smallint[]`),
    mealMinutes: integer('meal_minutes').notNull().default(30),
    mealAfterMinutes: integer('meal_after_minutes').notNull().default(300),
    restMinutes: integer('rest_minutes').notNull().default(10),
    restEveryMinutes: integer('rest_every_minutes').notNull().default(240),
    staggerBreaks: boolean('stagger_breaks').notNull().default(true),
    createdByEmploymentId: uuid('created_by_employment_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    unique('schedule_templates_org_id_unique').on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.locationId],
      foreignColumns: [locations.organizationId, locations.id],
      name: 'schedule_templates_location_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.organizationId, t.createdByEmploymentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'schedule_templates_created_by_tenant_fk',
    }),
    check(
      'schedule_templates_meal_check',
      sql`${t.mealMinutes} >= 0 and ${t.mealAfterMinutes} > 0`,
    ),
    check(
      'schedule_templates_rest_check',
      sql`${t.restMinutes} >= 0 and ${t.restEveryMinutes} > 0`,
    ),
  ],
)

/** Where a day got to in the review stack. No row means "not looked at yet". */
export const scheduleDayReviews = pgTable(
  'schedule_day_reviews',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    scheduleId: uuid('schedule_id').notNull(),
    onDate: date('on_date').notNull(),
    state: text('state').notNull(),
    note: text('note').notNull().default(''),
    reviewedByEmploymentId: uuid('reviewed_by_employment_id'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('schedule_day_reviews_unique').on(t.organizationId, t.scheduleId, t.onDate),
    foreignKey({
      columns: [t.organizationId, t.scheduleId],
      foreignColumns: [schedules.organizationId, schedules.id],
      name: 'schedule_day_reviews_schedule_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.organizationId, t.reviewedByEmploymentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'schedule_day_reviews_reviewer_tenant_fk',
    }),
    check('schedule_day_reviews_state_check', sql`${t.state} in ('approved','flagged')`),
  ],
)

/**
 * A manager's decision to schedule somebody against their stated availability.
 *
 * Warn, do not block - except approved time off, which is locked, and which is
 * why there is no `kind` here that could describe one. The row is what lets the
 * final check list every override before publishing, and what lets the person
 * see, on their own schedule, that the choice was deliberate.
 */
export const scheduleOverrides = pgTable(
  'schedule_overrides',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    scheduleId: uuid('schedule_id').notNull(),
    shiftId: uuid('shift_id').notNull(),
    employmentId: uuid('employment_id').notNull(),
    kind: text('kind').notNull(),
    reason: text('reason').notNull().default(''),
    decidedByEmploymentId: uuid('decided_by_employment_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('schedule_overrides_unique').on(t.organizationId, t.shiftId),
    foreignKey({
      columns: [t.organizationId, t.scheduleId],
      foreignColumns: [schedules.organizationId, schedules.id],
      name: 'schedule_overrides_schedule_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.organizationId, t.shiftId],
      foreignColumns: [shifts.organizationId, shifts.id],
      name: 'schedule_overrides_shift_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.organizationId, t.employmentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'schedule_overrides_employment_tenant_fk',
    }).onDelete('cascade'),
    check('schedule_overrides_kind_check', sql`${t.kind} in ('unavailable','not_preferred')`),
  ],
)

/** Somebody cannot work a shift they were given. Replacing them is a decision. */
export const shiftCallouts = pgTable(
  'shift_callouts',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    shiftId: uuid('shift_id').notNull(),
    employmentId: uuid('employment_id').notNull(),
    reason: text('reason').notNull().default(''),
    reportedByEmploymentId: uuid('reported_by_employment_id'),
    reportedAt: timestamp('reported_at', { withTimezone: true }).notNull().defaultNow(),
    replacementEmploymentId: uuid('replacement_employment_id'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    unique('shift_callouts_open_unique').on(t.organizationId, t.shiftId),
    foreignKey({
      columns: [t.organizationId, t.shiftId],
      foreignColumns: [shifts.organizationId, shifts.id],
      name: 'shift_callouts_shift_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.organizationId, t.employmentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'shift_callouts_employment_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.organizationId, t.replacementEmploymentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'shift_callouts_replacement_tenant_fk',
    }),
  ],
)
