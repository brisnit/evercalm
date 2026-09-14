import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
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
import { jobRoles } from '@/modules/structure/schema'

/**
 * ONBOARDING.
 *
 * THE VERSION MODEL, which is the whole reason this is three tables rather
 * than one:
 *
 *   onboarding_templates          the durable thing an administrator names,
 *                                 archives, and assigns. Holds no content.
 *   onboarding_template_versions  a numbered revision. Content hangs off a
 *                                 VERSION, never off the template.
 *   onboarding_sections / _steps  the content, owned by one version.
 *
 * A version is either `draft` or `published`. **A published version is
 * immutable**: the service refuses to edit its sections or steps, so editing a
 * live checklist means creating a new draft version and publishing that. An
 * assignment points at the exact version it started on, so somebody halfway
 * through week one never has the ground moved under them.
 *
 * STEP KINDS are also the integration boundary with later slices.
 * `policy_ack` and `training_assignment` carry a `reference_type` /
 * `reference_id` pair that is NULL today: those systems are not built. An
 * administrator can configure the step now, and it reports as waiting on
 * EverCalm rather than as something the new hire failed to do.
 */

export const ONBOARDING_STEP_KINDS = [
  /** Something to read. No action beyond acknowledging you saw it. */
  'information',
  /** The new hire does it and marks it done. */
  'employee_task',
  /** A manager does it on the new hire's behalf. */
  'manager_task',
  /** A document the new hire supplies. Storage arrives in a later slice. */
  'document_request',
  /** Placeholder for policy acknowledgement records. */
  'policy_ack',
  /** A published training course, assigned and tracked in Training. */
  'training_assignment',
  /** A manager watches them do it and signs off. */
  'practical_verification',
  /** A licence or certification that must be on file. */
  'credential_requirement',
] as const
export type OnboardingStepKind = (typeof ONBOARDING_STEP_KINDS)[number]

/** Who is expected to act on a step. Drives the employee's own checklist. */
export const ONBOARDING_RESPONSIBILITIES = [
  'employee',
  'manager',
  'hr',
  'training_manager',
] as const
export type OnboardingResponsibility = (typeof ONBOARDING_RESPONSIBILITIES)[number]

/** What a due-date offset counts from. */
export const DUE_DATE_BASES = ['hire_date', 'onboarding_start'] as const
export type DueDateBasis = (typeof DUE_DATE_BASES)[number]

export const ONBOARDING_STEP_STATUSES = ['pending', 'completed', 'blocked', 'waived'] as const
export type OnboardingStepStatus = (typeof ONBOARDING_STEP_STATUSES)[number]

export const TEMPLATE_STATUSES = ['draft', 'published', 'archived'] as const
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number]

/**
 * The durable template. Content lives on its versions.
 */
export const onboardingTemplates = pgTable(
  'onboarding_templates',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    /**
     * Used when no job-role or location targeted template matches. At most one
     * per organization, enforced by a partial unique index in the migration.
     */
    isDefault: boolean('is_default').notNull().default(false),
    status: text('status').notNull().default('draft'),
    /** The version new assignments receive. NULL until first published. */
    publishedVersionId: uuid('published_version_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedByEmploymentId: uuid('archived_by_employment_id'),
  },
  (t) => [
    unique('onboarding_templates_org_id_unique').on(t.organizationId, t.id),
    check('onboarding_templates_status_check', sql`status in ('draft','published','archived')`),
    index('onboarding_templates_org_idx').on(t.organizationId),
  ],
)

/**
 * A numbered revision. Published versions are immutable.
 */
export const onboardingTemplateVersions = pgTable(
  'onboarding_template_versions',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    templateId: uuid('template_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    status: text('status').notNull().default('draft'),
    /** Frozen for history, so a later rename does not rewrite the past. */
    templateName: text('template_name').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedByEmploymentId: uuid('published_by_employment_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('onboarding_versions_org_id_unique').on(t.organizationId, t.id),
    unique('onboarding_versions_number_unique').on(t.organizationId, t.templateId, t.versionNumber),
    check('onboarding_versions_status_check', sql`status in ('draft','published')`),
    foreignKey({
      columns: [t.organizationId, t.templateId],
      foreignColumns: [onboardingTemplates.organizationId, onboardingTemplates.id],
      name: 'onboarding_versions_template_tenant_fk',
    }).onDelete('cascade'),
    index('onboarding_versions_template_idx').on(t.organizationId, t.templateId),
  ],
)

/** Which job roles a template applies to. Empty means any role. */
export const onboardingTemplateJobRoles = pgTable(
  'onboarding_template_job_roles',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    templateId: uuid('template_id').notNull(),
    jobRoleId: uuid('job_role_id').notNull(),
  },
  (t) => [
    unique('onboarding_template_job_roles_unique').on(t.organizationId, t.templateId, t.jobRoleId),
    foreignKey({
      columns: [t.organizationId, t.templateId],
      foreignColumns: [onboardingTemplates.organizationId, onboardingTemplates.id],
      name: 'onboarding_template_job_roles_template_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.organizationId, t.jobRoleId],
      foreignColumns: [jobRoles.organizationId, jobRoles.id],
      name: 'onboarding_template_job_roles_role_tenant_fk',
    }).onDelete('cascade'),
    index('onboarding_template_job_roles_org_idx').on(t.organizationId),
  ],
)

/** Which locations a template applies to. Empty means every location. */
export const onboardingTemplateLocations = pgTable(
  'onboarding_template_locations',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    templateId: uuid('template_id').notNull(),
    locationId: uuid('location_id').notNull(),
  },
  (t) => [
    unique('onboarding_template_locations_unique').on(t.organizationId, t.templateId, t.locationId),
    foreignKey({
      columns: [t.organizationId, t.templateId],
      foreignColumns: [onboardingTemplates.organizationId, onboardingTemplates.id],
      name: 'onboarding_template_locations_template_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.organizationId, t.locationId],
      foreignColumns: [locations.organizationId, locations.id],
      name: 'onboarding_template_locations_location_tenant_fk',
    }).onDelete('cascade'),
    index('onboarding_template_locations_org_idx').on(t.organizationId),
  ],
)

export const onboardingSections = pgTable(
  'onboarding_sections',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    versionId: uuid('version_id').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('onboarding_sections_org_id_unique').on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.versionId],
      foreignColumns: [onboardingTemplateVersions.organizationId, onboardingTemplateVersions.id],
      name: 'onboarding_sections_version_tenant_fk',
    }).onDelete('cascade'),
    index('onboarding_sections_version_idx').on(t.organizationId, t.versionId),
  ],
)

export const onboardingSteps = pgTable(
  'onboarding_steps',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    versionId: uuid('version_id').notNull(),
    sectionId: uuid('section_id').notNull(),

    title: text('title').notNull(),
    /** Shown to whoever is responsible, on their own screen. */
    instructions: text('instructions').notNull().default(''),
    kind: text('kind').notNull().default('employee_task'),
    responsibility: text('responsibility').notNull().default('employee'),
    required: boolean('required').notNull().default(true),
    position: integer('position').notNull().default(0),

    /** Days after the basis date. Null means no due date. */
    dueOffsetDays: integer('due_offset_days'),
    dueOffsetBasis: text('due_offset_basis').notNull().default('onboarding_start'),

    /** A manager must confirm, even for a step the employee performs. */
    requiresManagerVerification: boolean('requires_manager_verification').notNull().default(false),
    /**
     * Whether leaving this step incomplete holds up the whole onboarding.
     * A non-blocking optional step is informational only.
     */
    blocksCompletion: boolean('blocks_completion').notNull().default(true),

    /** Integration boundary with later slices. Null until those exist. */
    referenceType: text('reference_type'),
    referenceId: uuid('reference_id'),
    /**
     * The published course a `training_assignment` step gives the new hire.
     * Composite foreign key to courses in migration 0017, so it can never
     * name another organization's course.
     */
    courseId: uuid('course_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('onboarding_steps_org_id_unique').on(t.organizationId, t.id),
    check(
      'onboarding_steps_kind_check',
      sql`kind in ('information','employee_task','manager_task','document_request','policy_ack','training_assignment','practical_verification','credential_requirement')`,
    ),
    check(
      'onboarding_steps_responsibility_check',
      sql`responsibility in ('employee','manager','hr','training_manager')`,
    ),
    check(
      'onboarding_steps_due_basis_check',
      sql`due_offset_basis in ('hire_date','onboarding_start')`,
    ),
    foreignKey({
      columns: [t.organizationId, t.versionId],
      foreignColumns: [onboardingTemplateVersions.organizationId, onboardingTemplateVersions.id],
      name: 'onboarding_steps_version_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.organizationId, t.sectionId],
      foreignColumns: [onboardingSections.organizationId, onboardingSections.id],
      name: 'onboarding_steps_section_tenant_fk',
    }).onDelete('cascade'),
    index('onboarding_steps_version_idx').on(t.organizationId, t.versionId),
  ],
)

export const onboardingAssignments = pgTable(
  'onboarding_assignments',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    employmentId: uuid('employment_id').notNull(),
    templateId: uuid('template_id').notNull(),
    /** The exact immutable version this run started on. */
    templateVersionId: uuid('template_version_id').notNull(),
    templateVersionNumber: integer('template_version_number').notNull(),
    /** Frozen name, so renaming or archiving never rewrites history. */
    templateName: text('template_name').notNull(),
    startedOn: date('started_on').notNull(),
    dueOn: date('due_on'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('onboarding_assignments_org_id_unique').on(t.organizationId, t.id),
    unique('onboarding_assignments_one_per_person').on(t.organizationId, t.employmentId),
    foreignKey({
      columns: [t.organizationId, t.employmentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'onboarding_assignments_employment_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.organizationId, t.templateId],
      foreignColumns: [onboardingTemplates.organizationId, onboardingTemplates.id],
      name: 'onboarding_assignments_template_tenant_fk',
    }),
    foreignKey({
      columns: [t.organizationId, t.templateVersionId],
      foreignColumns: [onboardingTemplateVersions.organizationId, onboardingTemplateVersions.id],
      name: 'onboarding_assignments_version_tenant_fk',
    }),
    index('onboarding_assignments_org_idx').on(t.organizationId),
  ],
)

export const onboardingStepProgress = pgTable(
  'onboarding_step_progress',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    assignmentId: uuid('assignment_id').notNull(),
    stepId: uuid('step_id').notNull(),

    /** Copied from the step, so history survives even a deleted draft. */
    sectionTitle: text('section_title').notNull().default(''),
    title: text('title').notNull(),
    instructions: text('instructions').notNull().default(''),
    kind: text('kind').notNull(),
    responsibility: text('responsibility').notNull().default('employee'),
    required: boolean('required').notNull().default(true),
    requiresManagerVerification: boolean('requires_manager_verification').notNull().default(false),
    blocksCompletion: boolean('blocks_completion').notNull().default(true),
    position: integer('position').notNull().default(0),
    dueOn: date('due_on'),

    status: text('status').notNull().default('pending'),
    note: text('note'),
    blockedReason: text('blocked_reason'),

    /** The course this step was linked to when onboarding started. */
    courseId: uuid('course_id'),
    /**
     * The training assignment that satisfies this step. It pins the course
     * version, so the version was fixed the moment onboarding started.
     */
    trainingAssignmentId: uuid('training_assignment_id'),

    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedByEmploymentId: uuid('completed_by_employment_id'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedByEmploymentId: uuid('verified_by_employment_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('onboarding_step_progress_unique').on(t.organizationId, t.assignmentId, t.stepId),
    check(
      'onboarding_step_progress_status_check',
      sql`status in ('pending','completed','blocked','waived')`,
    ),
    foreignKey({
      columns: [t.organizationId, t.assignmentId],
      foreignColumns: [onboardingAssignments.organizationId, onboardingAssignments.id],
      name: 'onboarding_step_progress_assignment_tenant_fk',
    }).onDelete('cascade'),
    index('onboarding_step_progress_assignment_idx').on(t.organizationId, t.assignmentId),
  ],
)
