import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { locations, organizations } from '@/modules/org/schema'
import { employments } from '@/modules/people/schema'
import { jobRoles, stations } from '@/modules/structure/schema'
import { shifts } from '@/modules/scheduling/schema'

/*
 * SHIFT OPERATIONS.
 *
 * Templates are versioned exactly like courses and onboarding checklists:
 *
 *   ops_templates           the identity people name and archive
 *   ops_template_versions   one editable draft, or one frozen published version
 *   ops_sections / _tasks   the content, owned by a VERSION
 *   ops_version_*           who a version applies to (location, role, station)
 *
 * A RUN is one template version applied to one PUBLISHED shift, and its TASK
 * ITEMS are the individual things to do. Runs and items carry the version id,
 * and composite foreign keys insist it matches, so what a shift was asked to do
 * can never be rewritten by a later edit.
 *
 * Handoffs are notes passed to the next shift at a location.
 *
 * Mirrored by drizzle/0018_operations.sql, which also carries the triggers that
 * freeze published versions, the published-version foreign key (a cycle), and
 * the grants that make history append-only.
 */

export const OPS_TEMPLATE_KINDS = [
  'pre_shift',
  'opening',
  'side_work',
  'station_setup',
  'shift_duties',
  'closing',
  'handoff',
] as const
export type OpsTemplateKind = (typeof OPS_TEMPLATE_KINDS)[number]

export const OPS_RESPONSE_TYPES = ['check', 'text', 'number', 'handoff'] as const
export type OpsResponseType = (typeof OPS_RESPONSE_TYPES)[number]

export const OPS_TIMING_ANCHORS = ['shift_start', 'shift_end'] as const
export type OpsTimingAnchor = (typeof OPS_TIMING_ANCHORS)[number]

export const OPS_ITEM_STATUSES = [
  'pending',
  'blocked',
  'skipped',
  'awaiting_verification',
  'done',
] as const
export type OpsItemStatus = (typeof OPS_ITEM_STATUSES)[number]

export const HANDOFF_CATEGORIES = [
  'staffing',
  'inventory',
  'maintenance',
  'safety',
  'guest',
  'follow_up',
] as const
export type HandoffCategory = (typeof HANDOFF_CATEGORIES)[number]

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}

const org = () =>
  uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' })

export const opsTemplates = pgTable(
  'ops_templates',
  {
    id: uuid('id').primaryKey(),
    organizationId: org(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('active'),
    /** Foreign key declared in SQL (it is a cycle). */
    publishedVersionId: uuid('published_version_id'),
    createdByEmploymentId: uuid('created_by_employment_id'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedByEmploymentId: uuid('archived_by_employment_id'),
    ...timestamps,
  },
  (t) => [
    unique('ops_templates_org_id_unique').on(t.organizationId, t.id),
    check(
      'ops_templates_kind_check',
      sql`${t.kind} in ('pre_shift','opening','side_work','station_setup','shift_duties','closing','handoff')`,
    ),
    check('ops_templates_status_check', sql`${t.status} in ('active','archived')`),
    check(
      'ops_templates_archived_check',
      sql`(${t.status} = 'archived') = (${t.archivedAt} is not null)`,
    ),
    uniqueIndex('ops_templates_name_unique')
      .on(t.organizationId, sql`lower(${t.name})`)
      .where(sql`status = 'active'`),
  ],
)

export const opsTemplateVersions = pgTable(
  'ops_template_versions',
  {
    id: uuid('id').primaryKey(),
    organizationId: org(),
    templateId: uuid('template_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    status: text('status').notNull().default('draft'),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    description: text('description').notNull().default(''),
    changeNote: text('change_note').notNull().default(''),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedByEmploymentId: uuid('published_by_employment_id'),
    createdByEmploymentId: uuid('created_by_employment_id'),
    ...timestamps,
  },
  (t) => [
    unique('ops_template_versions_org_id_unique').on(t.organizationId, t.id),
    unique('ops_template_versions_org_id_template_unique').on(t.organizationId, t.id, t.templateId),
    unique('ops_template_versions_number_unique').on(
      t.organizationId,
      t.templateId,
      t.versionNumber,
    ),
    foreignKey({
      columns: [t.organizationId, t.templateId],
      foreignColumns: [opsTemplates.organizationId, opsTemplates.id],
      name: 'ops_template_versions_template_tenant_fk',
    }).onDelete('cascade'),
    check('ops_template_versions_number_check', sql`${t.versionNumber} >= 1`),
    check('ops_template_versions_status_check', sql`${t.status} in ('draft','published')`),
    check(
      'ops_template_versions_published_check',
      sql`(${t.status} = 'published') = (${t.publishedAt} is not null)`,
    ),
    uniqueIndex('ops_template_versions_one_draft')
      .on(t.organizationId, t.templateId)
      .where(sql`status = 'draft'`),
  ],
)

export const opsVersionLocations = pgTable(
  'ops_version_locations',
  {
    id: uuid('id').primaryKey(),
    organizationId: org(),
    versionId: uuid('version_id').notNull(),
    locationId: uuid('location_id').notNull(),
  },
  (t) => [
    unique('ops_version_locations_unique').on(t.organizationId, t.versionId, t.locationId),
    foreignKey({
      columns: [t.organizationId, t.versionId],
      foreignColumns: [opsTemplateVersions.organizationId, opsTemplateVersions.id],
      name: 'ops_version_locations_version_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.organizationId, t.locationId],
      foreignColumns: [locations.organizationId, locations.id],
      name: 'ops_version_locations_location_tenant_fk',
    }),
  ],
)

export const opsVersionJobRoles = pgTable(
  'ops_version_job_roles',
  {
    id: uuid('id').primaryKey(),
    organizationId: org(),
    versionId: uuid('version_id').notNull(),
    jobRoleId: uuid('job_role_id').notNull(),
  },
  (t) => [
    unique('ops_version_job_roles_unique').on(t.organizationId, t.versionId, t.jobRoleId),
    foreignKey({
      columns: [t.organizationId, t.versionId],
      foreignColumns: [opsTemplateVersions.organizationId, opsTemplateVersions.id],
      name: 'ops_version_job_roles_version_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.organizationId, t.jobRoleId],
      foreignColumns: [jobRoles.organizationId, jobRoles.id],
      name: 'ops_version_job_roles_role_tenant_fk',
    }),
  ],
)

export const opsVersionStations = pgTable(
  'ops_version_stations',
  {
    id: uuid('id').primaryKey(),
    organizationId: org(),
    versionId: uuid('version_id').notNull(),
    stationId: uuid('station_id').notNull(),
  },
  (t) => [
    unique('ops_version_stations_unique').on(t.organizationId, t.versionId, t.stationId),
    foreignKey({
      columns: [t.organizationId, t.versionId],
      foreignColumns: [opsTemplateVersions.organizationId, opsTemplateVersions.id],
      name: 'ops_version_stations_version_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.organizationId, t.stationId],
      foreignColumns: [stations.organizationId, stations.id],
      name: 'ops_version_stations_station_tenant_fk',
    }),
  ],
)

export const opsSections = pgTable(
  'ops_sections',
  {
    id: uuid('id').primaryKey(),
    organizationId: org(),
    versionId: uuid('version_id').notNull(),
    title: text('title').notNull(),
    position: integer('position').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    unique('ops_sections_org_id_unique').on(t.organizationId, t.id),
    unique('ops_sections_org_id_version_unique').on(t.organizationId, t.id, t.versionId),
    foreignKey({
      columns: [t.organizationId, t.versionId],
      foreignColumns: [opsTemplateVersions.organizationId, opsTemplateVersions.id],
      name: 'ops_sections_version_tenant_fk',
    }).onDelete('cascade'),
  ],
)

export const opsTasks = pgTable(
  'ops_tasks',
  {
    id: uuid('id').primaryKey(),
    organizationId: org(),
    versionId: uuid('version_id').notNull(),
    sectionId: uuid('section_id').notNull(),
    position: integer('position').notNull().default(0),
    title: text('title').notNull(),
    instructions: text('instructions').notNull().default(''),
    required: boolean('required').notNull().default(true),
    responseType: text('response_type').notNull().default('check'),
    timingAnchor: text('timing_anchor').notNull().default('shift_start'),
    /** Minutes relative to the anchor; negative is before it. */
    offsetMinutes: integer('offset_minutes').notNull().default(0),
    requiresVerification: boolean('requires_verification').notNull().default(false),
    /** Anyone on the same shift run may complete it, not only the assignee. */
    shared: boolean('shared').notNull().default(false),
    sourceTaskId: uuid('source_task_id'),
    ...timestamps,
  },
  (t) => [
    unique('ops_tasks_org_id_unique').on(t.organizationId, t.id),
    unique('ops_tasks_org_id_version_unique').on(t.organizationId, t.id, t.versionId),
    foreignKey({
      columns: [t.organizationId, t.versionId],
      foreignColumns: [opsTemplateVersions.organizationId, opsTemplateVersions.id],
      name: 'ops_tasks_version_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.organizationId, t.sectionId, t.versionId],
      foreignColumns: [opsSections.organizationId, opsSections.id, opsSections.versionId],
      name: 'ops_tasks_section_tenant_fk',
    }).onDelete('cascade'),
    check(
      'ops_tasks_response_check',
      sql`${t.responseType} in ('check','text','number','handoff')`,
    ),
    check('ops_tasks_anchor_check', sql`${t.timingAnchor} in ('shift_start','shift_end')`),
    check('ops_tasks_offset_check', sql`${t.offsetMinutes} between -720 and 720`),
    index('ops_tasks_version_idx').on(t.organizationId, t.versionId, t.position),
  ],
)

export const opsRuns = pgTable(
  'ops_runs',
  {
    id: uuid('id').primaryKey(),
    organizationId: org(),
    shiftId: uuid('shift_id').notNull(),
    locationId: uuid('location_id').notNull(),
    templateId: uuid('template_id').notNull(),
    versionId: uuid('version_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    /** The local date the shift starts at its location. */
    businessDate: date('business_date').notNull(),
    assigneeEmploymentId: uuid('assignee_employment_id'),
    status: text('status').notNull().default('active'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancellationReason: text('cancellation_reason').notNull().default(''),
    remindedAt: timestamp('reminded_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique('ops_runs_org_id_unique').on(t.organizationId, t.id),
    unique('ops_runs_org_id_version_unique').on(t.organizationId, t.id, t.versionId),
    unique('ops_runs_shift_template_unique').on(t.organizationId, t.shiftId, t.templateId),
    foreignKey({
      columns: [t.organizationId, t.shiftId],
      foreignColumns: [shifts.organizationId, shifts.id],
      name: 'ops_runs_shift_tenant_fk',
    }),
    foreignKey({
      columns: [t.organizationId, t.locationId],
      foreignColumns: [locations.organizationId, locations.id],
      name: 'ops_runs_location_tenant_fk',
    }),
    foreignKey({
      columns: [t.organizationId, t.versionId, t.templateId],
      foreignColumns: [
        opsTemplateVersions.organizationId,
        opsTemplateVersions.id,
        opsTemplateVersions.templateId,
      ],
      name: 'ops_runs_version_tenant_fk',
    }),
    foreignKey({
      columns: [t.organizationId, t.assigneeEmploymentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'ops_runs_assignee_tenant_fk',
    }),
    check('ops_runs_status_check', sql`${t.status} in ('active','cancelled')`),
    check(
      'ops_runs_cancelled_check',
      sql`(${t.status} = 'cancelled') = (${t.cancelledAt} is not null)`,
    ),
    index('ops_runs_board_idx').on(t.organizationId, t.locationId, t.businessDate),
    index('ops_runs_assignee_idx').on(t.organizationId, t.assigneeEmploymentId, t.businessDate),
  ],
)

export const opsRunAssignees = pgTable(
  'ops_run_assignees',
  {
    id: uuid('id').primaryKey(),
    organizationId: org(),
    runId: uuid('run_id').notNull(),
    fromEmploymentId: uuid('from_employment_id'),
    toEmploymentId: uuid('to_employment_id'),
    reason: text('reason').notNull().default(''),
    changedByEmploymentId: uuid('changed_by_employment_id'),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.runId],
      foreignColumns: [opsRuns.organizationId, opsRuns.id],
      name: 'ops_run_assignees_run_tenant_fk',
    }),
  ],
)

export const opsTaskItems = pgTable(
  'ops_task_items',
  {
    id: uuid('id').primaryKey(),
    organizationId: org(),
    runId: uuid('run_id').notNull(),
    versionId: uuid('version_id').notNull(),
    taskId: uuid('task_id').notNull(),
    shiftId: uuid('shift_id').notNull(),
    assignedEmploymentId: uuid('assigned_employment_id'),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('pending'),
    responseText: text('response_text').notNull().default(''),
    responseNumber: numeric('response_number', { precision: 12, scale: 2 }),
    reason: text('reason').notNull().default(''),
    returnedNote: text('returned_note').notNull().default(''),
    completedByEmploymentId: uuid('completed_by_employment_id'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    verifiedByEmploymentId: uuid('verified_by_employment_id'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    reassignedFromEmploymentId: uuid('reassigned_from_employment_id'),
    reassignedAt: timestamp('reassigned_at', { withTimezone: true }),
    handoffId: uuid('handoff_id'),
    /** Bumped on every change; a stale write is refused rather than lost. */
    revision: integer('revision').notNull().default(1),
    ...timestamps,
  },
  (t) => [
    unique('ops_task_items_org_id_unique').on(t.organizationId, t.id),
    unique('ops_task_items_run_task_unique').on(t.organizationId, t.runId, t.taskId),
    foreignKey({
      columns: [t.organizationId, t.runId, t.versionId],
      foreignColumns: [opsRuns.organizationId, opsRuns.id, opsRuns.versionId],
      name: 'ops_task_items_run_tenant_fk',
    }),
    foreignKey({
      columns: [t.organizationId, t.taskId, t.versionId],
      foreignColumns: [opsTasks.organizationId, opsTasks.id, opsTasks.versionId],
      name: 'ops_task_items_task_tenant_fk',
    }),
    foreignKey({
      columns: [t.organizationId, t.shiftId],
      foreignColumns: [shifts.organizationId, shifts.id],
      name: 'ops_task_items_shift_tenant_fk',
    }),
    check(
      'ops_task_items_status_check',
      sql`${t.status} in ('pending','blocked','skipped','awaiting_verification','done')`,
    ),
    check(
      'ops_task_items_done_check',
      sql`${t.status} not in ('done','awaiting_verification','skipped') or (${t.completedAt} is not null and ${t.completedByEmploymentId} is not null)`,
    ),
    check(
      'ops_task_items_reason_check',
      sql`${t.status} not in ('skipped','blocked') or length(trim(${t.reason})) > 0`,
    ),
    index('ops_task_items_run_idx').on(t.organizationId, t.runId),
    index('ops_task_items_assigned_idx').on(t.organizationId, t.assignedEmploymentId, t.status),
  ],
)

export const opsTaskEvents = pgTable(
  'ops_task_events',
  {
    id: uuid('id').primaryKey(),
    organizationId: org(),
    itemId: uuid('item_id').notNull(),
    runId: uuid('run_id').notNull(),
    action: text('action').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    note: text('note').notNull().default(''),
    employmentId: uuid('employment_id'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.itemId],
      foreignColumns: [opsTaskItems.organizationId, opsTaskItems.id],
      name: 'ops_task_events_item_tenant_fk',
    }),
    foreignKey({
      columns: [t.organizationId, t.runId],
      foreignColumns: [opsRuns.organizationId, opsRuns.id],
      name: 'ops_task_events_run_tenant_fk',
    }),
    check(
      'ops_task_events_action_check',
      sql`${t.action} in ('generated','completed','submitted','skipped','blocked','unblocked','verified','returned','reassigned','reopened','cancelled','rescheduled')`,
    ),
    index('ops_task_events_item_idx').on(t.organizationId, t.itemId, t.at),
  ],
)

export const handoffs = pgTable(
  'handoffs',
  {
    id: uuid('id').primaryKey(),
    organizationId: org(),
    locationId: uuid('location_id').notNull(),
    shiftId: uuid('shift_id'),
    businessDate: date('business_date').notNull(),
    category: text('category').notNull(),
    priority: text('priority').notNull().default('normal'),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    authorEmploymentId: uuid('author_employment_id').notNull(),
    /** Who the handoff is for. Null means whoever is on next at the location. */
    assignedEmploymentId: uuid('assigned_employment_id'),
    taskItemId: uuid('task_item_id'),
    status: text('status').notNull().default('open'),
    resolvedByEmploymentId: uuid('resolved_by_employment_id'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolutionNote: text('resolution_note').notNull().default(''),
    ...timestamps,
  },
  (t) => [
    unique('handoffs_org_id_unique').on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.locationId],
      foreignColumns: [locations.organizationId, locations.id],
      name: 'handoffs_location_tenant_fk',
    }),
    foreignKey({
      columns: [t.organizationId, t.shiftId],
      foreignColumns: [shifts.organizationId, shifts.id],
      name: 'handoffs_shift_tenant_fk',
    }),
    foreignKey({
      columns: [t.organizationId, t.authorEmploymentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'handoffs_author_tenant_fk',
    }),
    foreignKey({
      columns: [t.organizationId, t.assignedEmploymentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'handoffs_assignee_tenant_fk',
    }),
    check(
      'handoffs_category_check',
      sql`${t.category} in ('staffing','inventory','maintenance','safety','guest','follow_up')`,
    ),
    check('handoffs_priority_check', sql`${t.priority} in ('normal','urgent')`),
    check('handoffs_status_check', sql`${t.status} in ('open','resolved')`),
    check(
      'handoffs_resolved_check',
      sql`(${t.status} = 'resolved') = (${t.resolvedAt} is not null and ${t.resolvedByEmploymentId} is not null)`,
    ),
    index('handoffs_location_idx').on(t.organizationId, t.locationId, t.status, t.createdAt),
    index('handoffs_assignee_idx').on(t.organizationId, t.assignedEmploymentId, t.status),
  ],
)

export const handoffAcknowledgements = pgTable(
  'handoff_acknowledgements',
  {
    id: uuid('id').primaryKey(),
    organizationId: org(),
    handoffId: uuid('handoff_id').notNull(),
    employmentId: uuid('employment_id').notNull(),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('handoff_acknowledgements_unique').on(t.organizationId, t.handoffId, t.employmentId),
    foreignKey({
      columns: [t.organizationId, t.handoffId],
      foreignColumns: [handoffs.organizationId, handoffs.id],
      name: 'handoff_acknowledgements_handoff_tenant_fk',
    }),
    foreignKey({
      columns: [t.organizationId, t.employmentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'handoff_acknowledgements_employment_tenant_fk',
    }),
  ],
)
