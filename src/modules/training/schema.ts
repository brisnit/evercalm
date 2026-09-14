import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
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

/*
 * TRAINING.
 *
 * A course is three things, the same shape as an onboarding checklist:
 *
 *   courses          the identity people name, archive and assign
 *   course_versions  one editable draft, or one frozen published version
 *   course_lessons   the content, owned by a VERSION, never by the course
 *
 * An assignment pins the exact version it was given. Progress, quiz attempts
 * and sign-offs carry that version id too, and composite foreign keys insist
 * it matches - so a lesson from a later version can never be recorded against
 * an earlier assignment, and an assignment with progress cannot be moved.
 *
 * Mirrored by drizzle/0016_training.sql, which also carries what Drizzle
 * cannot express: the triggers that freeze published versions, the
 * courses -> published version foreign key (a cycle), and the grants that make
 * attempts and sign-offs append-only.
 *
 * Industry-neutral. A restaurant's course is "Allergen awareness" with a
 * practical at the pass; a salon's is "Patch testing" with a practical at the
 * colour bar. Nothing here knows which.
 */

export const COURSE_STATUSES = ['active', 'archived'] as const
export const VERSION_STATUSES = ['draft', 'published'] as const
export type VersionStatus = (typeof VERSION_STATUSES)[number]

export const ASSIGNMENT_STATUSES = ['assigned', 'in_progress', 'completed', 'cancelled'] as const
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number]
/** An assignment somebody still has to finish. */
export const OPEN_ASSIGNMENT_STATUSES: readonly AssignmentStatus[] = ['assigned', 'in_progress']

export const ASSIGNMENT_SOURCES = ['manual', 'job_role', 'onboarding'] as const
export type AssignmentSource = (typeof ASSIGNMENT_SOURCES)[number]

export const PROGRESS_STATUSES = [
  'in_progress',
  'awaiting_signoff',
  'returned',
  'completed',
] as const
export type ProgressStatus = (typeof PROGRESS_STATUSES)[number]

export const SIGNOFF_DECISIONS = ['verified', 'returned'] as const
export type SignoffDecision = (typeof SIGNOFF_DECISIONS)[number]

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}

export const courses = pgTable(
  'courses',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** The working title. Each version carries the title it was published with. */
    title: text('title').notNull(),
    status: text('status').notNull().default('active'),
    /** The version new assignments receive. Foreign key declared in SQL (it is a cycle). */
    publishedVersionId: uuid('published_version_id'),
    createdByEmploymentId: uuid('created_by_employment_id'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedByEmploymentId: uuid('archived_by_employment_id'),
    ...timestamps,
  },
  (t) => [
    unique('courses_org_id_unique').on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.createdByEmploymentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'courses_created_by_tenant_fk',
    }),
    foreignKey({
      columns: [t.organizationId, t.archivedByEmploymentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'courses_archived_by_tenant_fk',
    }),
    check('courses_status_check', sql`${t.status} in ('active','archived')`),
    check(
      'courses_archived_check',
      sql`(${t.status} = 'archived') = (${t.archivedAt} is not null)`,
    ),
    uniqueIndex('courses_title_unique')
      .on(t.organizationId, sql`lower(${t.title})`)
      .where(sql`status = 'active'`),
  ],
)

export const courseVersions = pgTable(
  'course_versions',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    status: text('status').notNull().default('draft'),
    title: text('title').notNull(),
    summary: text('summary').notNull().default(''),
    /** What changed from the previous version, in the author's words. */
    changeNote: text('change_note').notNull().default(''),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedByEmploymentId: uuid('published_by_employment_id'),
    createdByEmploymentId: uuid('created_by_employment_id'),
    ...timestamps,
  },
  (t) => [
    unique('course_versions_org_id_unique').on(t.organizationId, t.id),
    unique('course_versions_org_id_course_unique').on(t.organizationId, t.id, t.courseId),
    unique('course_versions_number_unique').on(t.organizationId, t.courseId, t.versionNumber),
    foreignKey({
      columns: [t.organizationId, t.courseId],
      foreignColumns: [courses.organizationId, courses.id],
      name: 'course_versions_course_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.organizationId, t.publishedByEmploymentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'course_versions_published_by_tenant_fk',
    }),
    foreignKey({
      columns: [t.organizationId, t.createdByEmploymentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'course_versions_created_by_tenant_fk',
    }),
    check('course_versions_number_check', sql`${t.versionNumber} >= 1`),
    check('course_versions_status_check', sql`${t.status} in ('draft','published')`),
    check(
      'course_versions_published_check',
      sql`(${t.status} = 'published') = (${t.publishedAt} is not null)`,
    ),
    uniqueIndex('course_versions_one_draft')
      .on(t.organizationId, t.courseId)
      .where(sql`status = 'draft'`),
  ],
)

export const courseLessons = pgTable(
  'course_lessons',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    versionId: uuid('version_id').notNull(),
    position: integer('position').notNull().default(0),
    title: text('title').notNull(),
    kind: text('kind').notNull(),
    /** Plain text with light formatting, rendered by the announcement body renderer. */
    body: text('body').notNull().default(''),
    estimatedMinutes: smallint('estimated_minutes').notNull().default(5),
    /** Checklist items, quiz questions or practical criteria. See ./content.ts. */
    content: jsonb('content').$type<Record<string, unknown>>().notNull().default({}),
    /** The lesson this one was copied from when a new draft was started. */
    sourceLessonId: uuid('source_lesson_id'),
    ...timestamps,
  },
  (t) => [
    unique('course_lessons_org_id_unique').on(t.organizationId, t.id),
    unique('course_lessons_org_id_version_unique').on(t.organizationId, t.id, t.versionId),
    foreignKey({
      columns: [t.organizationId, t.versionId],
      foreignColumns: [courseVersions.organizationId, courseVersions.id],
      name: 'course_lessons_version_tenant_fk',
    }).onDelete('cascade'),
    check(
      'course_lessons_kind_check',
      sql`${t.kind} in ('reading','checklist','quiz','practical')`,
    ),
    check('course_lessons_minutes_check', sql`${t.estimatedMinutes} between 1 and 240`),
    check('course_lessons_content_check', sql`jsonb_typeof(${t.content}) = 'object'`),
    index('course_lessons_version_idx').on(t.organizationId, t.versionId, t.position),
  ],
)

export const trainingAssignments = pgTable(
  'training_assignments',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    employmentId: uuid('employment_id').notNull(),
    courseId: uuid('course_id').notNull(),
    /** The exact version this person was given. */
    courseVersionId: uuid('course_version_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    /** The location the assigning manager acted for. */
    locationId: uuid('location_id'),
    source: text('source').notNull().default('manual'),
    required: boolean('required').notNull().default(true),
    dueOn: date('due_on'),
    note: text('note').notNull().default(''),
    status: text('status').notNull().default('assigned'),
    assignedByEmploymentId: uuid('assigned_by_employment_id'),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledByEmploymentId: uuid('cancelled_by_employment_id'),
    cancellationReason: text('cancellation_reason').notNull().default(''),
    /** Set when a manager moved a not-yet-started assignment to a newer version. */
    previousVersionId: uuid('previous_version_id'),
    ...timestamps,
  },
  (t) => [
    unique('training_assignments_org_id_unique').on(t.organizationId, t.id),
    unique('training_assignments_org_id_version_unique').on(
      t.organizationId,
      t.id,
      t.courseVersionId,
    ),
    foreignKey({
      columns: [t.organizationId, t.employmentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'training_assignments_employment_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.organizationId, t.courseVersionId, t.courseId],
      foreignColumns: [courseVersions.organizationId, courseVersions.id, courseVersions.courseId],
      name: 'training_assignments_version_tenant_fk',
    }),
    foreignKey({
      columns: [t.organizationId, t.previousVersionId],
      foreignColumns: [courseVersions.organizationId, courseVersions.id],
      name: 'training_assignments_previous_version_tenant_fk',
    }),
    foreignKey({
      columns: [t.organizationId, t.locationId],
      foreignColumns: [locations.organizationId, locations.id],
      name: 'training_assignments_location_tenant_fk',
    }),
    foreignKey({
      columns: [t.organizationId, t.assignedByEmploymentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'training_assignments_assigned_by_tenant_fk',
    }),
    foreignKey({
      columns: [t.organizationId, t.cancelledByEmploymentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'training_assignments_cancelled_by_tenant_fk',
    }),
    check(
      'training_assignments_source_check',
      sql`${t.source} in ('manual','job_role','onboarding')`,
    ),
    check(
      'training_assignments_status_check',
      sql`${t.status} in ('assigned','in_progress','completed','cancelled')`,
    ),
    check(
      'training_assignments_completed_check',
      sql`(${t.status} = 'completed') = (${t.completedAt} is not null)`,
    ),
    check(
      'training_assignments_cancelled_check',
      sql`(${t.status} = 'cancelled') = (${t.cancelledAt} is not null)`,
    ),
    check(
      'training_assignments_started_check',
      sql`${t.status} = 'assigned' or ${t.status} = 'cancelled' or ${t.startedAt} is not null`,
    ),
    uniqueIndex('training_assignments_one_open')
      .on(t.organizationId, t.employmentId, t.courseId)
      .where(sql`status in ('assigned','in_progress')`),
    index('training_assignments_employment_idx').on(t.organizationId, t.employmentId, t.status),
    index('training_assignments_course_idx').on(t.organizationId, t.courseId, t.status),
  ],
)

export const trainingLessonProgress = pgTable(
  'training_lesson_progress',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    assignmentId: uuid('assignment_id').notNull(),
    versionId: uuid('version_id').notNull(),
    lessonId: uuid('lesson_id').notNull(),
    employmentId: uuid('employment_id').notNull(),
    status: text('status').notNull().default('in_progress'),
    /** Checklist items ticked so far. */
    checkedItemIds: text('checked_item_ids')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Further quiz attempts a manager has allowed beyond the lesson's limit. */
    extraAttempts: smallint('extra_attempts').notNull().default(0),
    signoffRequestedAt: timestamp('signoff_requested_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique('training_lesson_progress_org_id_unique').on(t.organizationId, t.id),
    unique('training_lesson_progress_lesson_unique').on(
      t.organizationId,
      t.assignmentId,
      t.lessonId,
    ),
    foreignKey({
      columns: [t.organizationId, t.assignmentId, t.versionId],
      foreignColumns: [
        trainingAssignments.organizationId,
        trainingAssignments.id,
        trainingAssignments.courseVersionId,
      ],
      name: 'training_lesson_progress_assignment_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.organizationId, t.lessonId, t.versionId],
      foreignColumns: [courseLessons.organizationId, courseLessons.id, courseLessons.versionId],
      name: 'training_lesson_progress_lesson_tenant_fk',
    }),
    foreignKey({
      columns: [t.organizationId, t.employmentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'training_lesson_progress_employment_tenant_fk',
    }).onDelete('cascade'),
    check(
      'training_lesson_progress_status_check',
      sql`${t.status} in ('in_progress','awaiting_signoff','returned','completed')`,
    ),
    check(
      'training_lesson_progress_completed_check',
      sql`(${t.status} = 'completed') = (${t.completedAt} is not null)`,
    ),
    check(
      'training_lesson_progress_extra_attempts_check',
      sql`${t.extraAttempts} between 0 and 20`,
    ),
    index('training_lesson_progress_status_idx').on(t.organizationId, t.status),
  ],
)

export const trainingQuizAttempts = pgTable(
  'training_quiz_attempts',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    assignmentId: uuid('assignment_id').notNull(),
    versionId: uuid('version_id').notNull(),
    lessonId: uuid('lesson_id').notNull(),
    employmentId: uuid('employment_id').notNull(),
    attemptNumber: smallint('attempt_number').notNull(),
    /** Question id -> chosen option ids, exactly as submitted. */
    answers: jsonb('answers').$type<Record<string, string[]>>().notNull().default({}),
    correctCount: smallint('correct_count').notNull(),
    questionCount: smallint('question_count').notNull(),
    scorePercent: smallint('score_percent').notNull(),
    passed: boolean('passed').notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('training_quiz_attempts_number_unique').on(
      t.organizationId,
      t.assignmentId,
      t.lessonId,
      t.attemptNumber,
    ),
    foreignKey({
      columns: [t.organizationId, t.assignmentId, t.versionId],
      foreignColumns: [
        trainingAssignments.organizationId,
        trainingAssignments.id,
        trainingAssignments.courseVersionId,
      ],
      name: 'training_quiz_attempts_assignment_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.organizationId, t.lessonId, t.versionId],
      foreignColumns: [courseLessons.organizationId, courseLessons.id, courseLessons.versionId],
      name: 'training_quiz_attempts_lesson_tenant_fk',
    }),
    foreignKey({
      columns: [t.organizationId, t.employmentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'training_quiz_attempts_employment_tenant_fk',
    }).onDelete('cascade'),
    check('training_quiz_attempts_number_check', sql`${t.attemptNumber} >= 1`),
    check(
      'training_quiz_attempts_score_check',
      sql`${t.scorePercent} between 0 and 100 and ${t.correctCount} between 0 and ${t.questionCount}`,
    ),
  ],
)

export const trainingSignoffs = pgTable(
  'training_signoffs',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    progressId: uuid('progress_id').notNull(),
    assignmentId: uuid('assignment_id').notNull(),
    lessonId: uuid('lesson_id').notNull(),
    employmentId: uuid('employment_id').notNull(),
    decision: text('decision').notNull(),
    note: text('note').notNull().default(''),
    criteriaConfirmed: text('criteria_confirmed')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    decidedByEmploymentId: uuid('decided_by_employment_id').notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.progressId],
      foreignColumns: [trainingLessonProgress.organizationId, trainingLessonProgress.id],
      name: 'training_signoffs_progress_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.organizationId, t.assignmentId],
      foreignColumns: [trainingAssignments.organizationId, trainingAssignments.id],
      name: 'training_signoffs_assignment_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.organizationId, t.lessonId],
      foreignColumns: [courseLessons.organizationId, courseLessons.id],
      name: 'training_signoffs_lesson_tenant_fk',
    }),
    foreignKey({
      columns: [t.organizationId, t.employmentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'training_signoffs_employment_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.organizationId, t.decidedByEmploymentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'training_signoffs_decided_by_tenant_fk',
    }),
    check('training_signoffs_decision_check', sql`${t.decision} in ('verified','returned')`),
    check('training_signoffs_not_self_check', sql`${t.decidedByEmploymentId} <> ${t.employmentId}`),
    index('training_signoffs_progress_idx').on(t.organizationId, t.progressId),
  ],
)
