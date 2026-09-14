import { and, asc, desc, eq, inArray, isNull, lt, ne, sql } from 'drizzle-orm'
import type { Tx } from '@/server/db'
import {
  employmentJobRoles,
  employmentLocations,
  employments,
  jobRoles,
  locations,
} from '@/server/db/schema'
import type { Actor, Capability } from '@/server/authz'
import { can } from '@/server/authz/can'
import { AUDIT_ACTIONS, recordAuditEvent } from '@/server/audit'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { newId } from '@/lib/ids'
import { businessDate, formatCalendarDate } from '@/lib/dates'
import {
  canSeeDrafts,
  canUseTrainingAdmin,
  canViewProgressAnywhere,
  locationsWhere,
  progressScope,
  requirePersonCapability,
  scopeFor,
  type LocationRef,
} from './access'
import { attemptsAllowed, parseLessonContent, type ContentItem } from './content'
import {
  relinkOnboardingSteps,
  syncOnboardingForTraining,
} from '@/modules/onboarding/training-link'
import { cleanNote } from './learner'
import { notifyTrainingPeople } from './notify'
import {
  daysBetween,
  dueStatus,
  managerStatus,
  type AssignmentState,
  type DueKind,
  type StatusTone,
} from './progress'
import {
  locationNamesFor,
  progressFor,
  settleAssignment,
  timeZonesFor,
  type AssignmentRow,
} from './records'
import {
  courseLessons,
  courseVersions,
  courses,
  trainingAssignments,
  trainingLessonProgress,
  trainingQuizAttempts,
  trainingSignoffs,
} from './schema'

/*
 * ASSIGNING, FOLLOWING UP, SIGNING OFF.
 *
 * Everything about PEOPLE is location-scoped: a manager assigns, reads and
 * signs off the people who work at their locations, and anyone else is not
 * found. See ./access.ts for the capability model.
 *
 * Assignment pins the course's CURRENT published version at that moment. A
 * later publication changes nothing for anyone already assigned; people who
 * have not started can be moved to the newer version by a manager, on
 * purpose, and the database refuses to move anybody who has.
 */

const MAX_PEOPLE_PER_ASSIGNMENT = 200

/** Seeing a location's people in training at all, short of the specific capability. */
const LOCATION_VISIBILITY: readonly Capability[] = [
  'training.assign',
  'training.view_progress_team',
  'skill.verify',
]

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

async function requireLocationFor(
  tx: Tx,
  actor: Actor,
  locationId: string,
  capability: Capability,
): Promise<LocationRef> {
  const [location] = await tx
    .select({ id: locations.id, name: locations.name, timeZone: locations.timezone })
    .from(locations)
    .where(
      and(
        eq(locations.organizationId, actor.organizationId),
        eq(locations.id, locationId),
        isNull(locations.archivedAt),
      ),
    )
    .limit(1)
  if (!location) throw new NotFoundError('Location not found')
  if (can(actor, capability, { locationId })) return location
  const visible =
    can(actor, 'training.view_progress_org') ||
    LOCATION_VISIBILITY.some((c) => can(actor, c, { locationId }))
  if (visible) throw new ForbiddenError(capability)
  throw new NotFoundError('Location not found')
}

async function assignableCourse(
  tx: Tx,
  actor: Actor,
  courseId: string,
): Promise<{ course: typeof courses.$inferSelect; version: typeof courseVersions.$inferSelect }> {
  if (!canUseTrainingAdmin(actor)) throw new NotFoundError('Course not found')
  const [course] = await tx
    .select()
    .from(courses)
    .where(and(eq(courses.organizationId, actor.organizationId), eq(courses.id, courseId)))
    .limit(1)
  if (!course || (!course.publishedVersionId && !canSeeDrafts(actor))) {
    throw new NotFoundError('Course not found')
  }
  if (course.status !== 'active') {
    throw new ValidationError({}, 'This course is archived, so it cannot be assigned.')
  }
  if (!course.publishedVersionId) {
    throw new ValidationError({}, 'Publish this course before assigning it.')
  }
  const [version] = await tx
    .select()
    .from(courseVersions)
    .where(eq(courseVersions.id, course.publishedVersionId))
    .limit(1)
  return { course, version: version! }
}

// ---------------------------------------------------------------------------
// Choosing people
// ---------------------------------------------------------------------------

export interface AssignablePerson {
  employmentId: string
  displayName: string
  jobTitle: string | null
  jobRoleIds: string[]
  jobRoleNames: string[]
  /** Their most relevant existing assignment of this course, if any. */
  existing: {
    status: 'open' | 'completed'
    versionNumber: number
    completedAt: Date | null
  } | null
}

async function peopleAtLocation(
  tx: Tx,
  organizationId: string,
  locationId: string,
): Promise<{ employmentId: string; displayName: string; jobTitle: string | null }[]> {
  return tx
    .select({
      employmentId: employments.id,
      displayName: employments.displayName,
      jobTitle: employments.jobTitle,
    })
    .from(employments)
    .innerJoin(
      employmentLocations,
      and(
        eq(employmentLocations.organizationId, employments.organizationId),
        eq(employmentLocations.employmentId, employments.id),
      ),
    )
    .where(
      and(
        eq(employments.organizationId, organizationId),
        eq(employmentLocations.locationId, locationId),
        eq(employments.status, 'active'),
        isNull(employments.archivedAt),
      ),
    )
    .orderBy(asc(employments.displayName))
}

export async function listAssignablePeople(
  tx: Tx,
  actor: Actor,
  courseId: string,
  locationId: string,
): Promise<{
  location: LocationRef
  people: AssignablePerson[]
  jobRoles: { id: string; name: string; count: number }[]
}> {
  const location = await requireLocationFor(tx, actor, locationId, 'training.assign')
  await assignableCourse(tx, actor, courseId)
  const people = await peopleAtLocation(tx, actor.organizationId, locationId)
  const ids = people.map((p) => p.employmentId)

  const roleRows =
    ids.length === 0
      ? []
      : await tx
          .select({
            employmentId: employmentJobRoles.employmentId,
            jobRoleId: jobRoles.id,
            name: jobRoles.name,
          })
          .from(employmentJobRoles)
          .innerJoin(
            jobRoles,
            and(
              eq(jobRoles.organizationId, employmentJobRoles.organizationId),
              eq(jobRoles.id, employmentJobRoles.jobRoleId),
            ),
          )
          .where(
            and(
              eq(employmentJobRoles.organizationId, actor.organizationId),
              inArray(employmentJobRoles.employmentId, ids),
            ),
          )
          .orderBy(asc(jobRoles.name))

  const existing =
    ids.length === 0
      ? []
      : await tx
          .select()
          .from(trainingAssignments)
          .where(
            and(
              eq(trainingAssignments.organizationId, actor.organizationId),
              eq(trainingAssignments.courseId, courseId),
              inArray(trainingAssignments.employmentId, ids),
              ne(trainingAssignments.status, 'cancelled'),
            ),
          )
          .orderBy(desc(trainingAssignments.assignedAt))

  const roles = new Map<string, { id: string; name: string; count: number }>()
  for (const r of roleRows) {
    const entry = roles.get(r.jobRoleId) ?? { id: r.jobRoleId, name: r.name, count: 0 }
    entry.count += 1
    roles.set(r.jobRoleId, entry)
  }

  return {
    location,
    jobRoles: [...roles.values()].sort((a, b) => a.name.localeCompare(b.name)),
    people: people.map((p) => {
      const mine = existing.filter((a) => a.employmentId === p.employmentId)
      const open = mine.find((a) => a.status === 'assigned' || a.status === 'in_progress')
      const latest = open ?? mine[0]
      const theirRoles = roleRows.filter((r) => r.employmentId === p.employmentId)
      return {
        ...p,
        jobRoleIds: theirRoles.map((r) => r.jobRoleId),
        jobRoleNames: theirRoles.map((r) => r.name),
        existing: latest
          ? {
              status: open ? 'open' : 'completed',
              versionNumber: latest.versionNumber,
              completedAt: latest.completedAt,
            }
          : null,
      }
    }),
  }
}

// ---------------------------------------------------------------------------
// Assigning
// ---------------------------------------------------------------------------

export interface AssignInput {
  courseId: string
  locationId: string
  employmentIds: readonly string[]
  /** Everyone at the location holding this job role, as well. */
  jobRoleId: string | null
  dueOn: string | null
  required: boolean
  note: string
}

export interface AssignResult {
  assigned: number
  alreadyAssigned: string[]
  versionNumber: number
  courseTitle: string
}

export async function assignCourse(
  tx: Tx,
  actor: Actor,
  input: AssignInput,
  now = new Date(),
): Promise<AssignResult> {
  const location = await requireLocationFor(tx, actor, input.locationId, 'training.assign')
  const { course, version } = await assignableCourse(tx, actor, input.courseId)

  const today = businessDate(now, location.timeZone)
  const dueOn = input.dueOn?.trim() || null
  if (dueOn !== null && (!isIsoDate(dueOn) || dueOn < today)) {
    throw new ValidationError({ dueOn: ['Choose a due date that is today or later.'] })
  }
  const note = cleanNote(input.note)

  const here = await peopleAtLocation(tx, actor.organizationId, input.locationId)
  const hereById = new Map(here.map((p) => [p.employmentId, p]))

  const chosen = new Set(input.employmentIds)
  for (const id of chosen) {
    // Someone who does not work here - or does not exist - is not found. The
    // form only offered people at this location; anything else was invented.
    if (!hereById.has(id)) throw new NotFoundError('Person not found')
  }

  const byRole = new Set<string>()
  if (input.jobRoleId) {
    const holders = await tx
      .select({ employmentId: employmentJobRoles.employmentId })
      .from(employmentJobRoles)
      .where(
        and(
          eq(employmentJobRoles.organizationId, actor.organizationId),
          eq(employmentJobRoles.jobRoleId, input.jobRoleId),
        ),
      )
    for (const h of holders) if (hereById.has(h.employmentId)) byRole.add(h.employmentId)
    if (byRole.size === 0) {
      throw new ValidationError({ jobRoleId: ['Nobody at this location holds that job role.'] })
    }
  }

  const targets = [...new Set([...chosen, ...byRole])]
  if (targets.length === 0) {
    throw new ValidationError({ people: ['Choose at least one person, or a job role.'] })
  }
  if (targets.length > MAX_PEOPLE_PER_ASSIGNMENT) {
    throw new ValidationError(
      {},
      `Assign to at most ${MAX_PEOPLE_PER_ASSIGNMENT} people at a time.`,
    )
  }

  const created: { id: string; employmentId: string }[] = []
  const skipped: string[] = []
  for (const employmentId of targets) {
    const id = newId()
    const inserted = await tx
      .insert(trainingAssignments)
      .values({
        id,
        organizationId: actor.organizationId,
        employmentId,
        courseId: course.id,
        courseVersionId: version.id,
        versionNumber: version.versionNumber,
        locationId: location.id,
        source: chosen.has(employmentId) ? 'manual' : 'job_role',
        required: input.required,
        dueOn,
        note,
        assignedByEmploymentId: actor.employmentId,
        assignedAt: now,
      })
      // The partial unique index on open assignments decides; nobody is given
      // the same course twice at once, however the requests interleave.
      .onConflictDoNothing()
      .returning({ id: trainingAssignments.id })
    if (inserted.length === 0) skipped.push(hereById.get(employmentId)!.displayName)
    else created.push({ id, employmentId })
  }

  for (const assignment of created) {
    const person = hereById.get(assignment.employmentId)!
    await recordAuditEvent(tx, actor, {
      action: AUDIT_ACTIONS.TRAINING_ASSIGNED,
      summary: `Assigned "${version.title}" (version ${version.versionNumber}) to ${person.displayName}`,
      subjectType: 'training_assignment',
      subjectId: assignment.id,
      locationId: location.id,
      metadata: {
        employmentId: assignment.employmentId,
        courseId: course.id,
        versionNumber: version.versionNumber,
        dueOn,
        required: input.required,
      },
    })
  }

  // Someone given the course again after a withdrawal: their onboarding step follows.
  for (const assignment of created) {
    await relinkOnboardingSteps(
      tx,
      actor,
      {
        employmentId: assignment.employmentId,
        courseId: course.id,
        trainingAssignmentId: assignment.id,
      },
      now,
    )
  }

  await notifyTrainingPeople(
    tx,
    actor.organizationId,
    created.map((a) => ({
      employmentId: a.employmentId,
      subjectType: 'training_assignment' as const,
      subjectId: a.id,
      title: `New training: ${version.title}`,
      preview: dueOn
        ? `${actor.displayName} asked you to finish it by ${formatCalendarDate(dueOn)}.`
        : `${actor.displayName} assigned it to you.`,
      href: `/my/training/${a.id}`,
      purpose: 'assigned',
    })),
    now,
  )

  return {
    assigned: created.length,
    alreadyAssigned: skipped.sort(),
    versionNumber: version.versionNumber,
    courseTitle: version.title,
  }
}

async function lockAssignment(tx: Tx, actor: Actor, assignmentId: string): Promise<AssignmentRow> {
  const [row] = await tx
    .select()
    .from(trainingAssignments)
    .where(
      and(
        eq(trainingAssignments.organizationId, actor.organizationId),
        eq(trainingAssignments.id, assignmentId),
      ),
    )
    .for('update')
    .limit(1)
  if (!row) throw new NotFoundError('Training not found')
  return row
}

async function versionTitle(tx: Tx, versionId: string): Promise<string> {
  const [row] = await tx
    .select({ title: courseVersions.title })
    .from(courseVersions)
    .where(eq(courseVersions.id, versionId))
    .limit(1)
  return row?.title ?? 'Training'
}

/** Take back an open assignment. Its progress is kept, for the record. */
export async function withdrawAssignment(
  tx: Tx,
  actor: Actor,
  assignmentId: string,
  reason: string,
  now = new Date(),
): Promise<void> {
  const row = await lockAssignment(tx, actor, assignmentId)
  const allowedAt = await requirePersonCapability(tx, actor, row.employmentId, 'training.assign')
  if (row.status !== 'assigned' && row.status !== 'in_progress') {
    throw new ValidationError(
      {},
      row.status === 'completed'
        ? 'This training is already complete, so it stays on their record.'
        : 'This training has already been withdrawn.',
    )
  }
  const why = cleanNote(reason)
  if (!why) throw new ValidationError({ reason: ['Say why, so the record makes sense later.'] })

  await tx
    .update(trainingAssignments)
    .set({
      status: 'cancelled',
      cancelledAt: now,
      cancelledByEmploymentId: actor.employmentId,
      cancellationReason: why,
      updatedAt: now,
    })
    .where(eq(trainingAssignments.id, row.id))
  await syncOnboardingForTraining(tx, actor, [row.id], now)

  const title = await versionTitle(tx, row.courseVersionId)
  const [person] = await tx
    .select({ name: employments.displayName })
    .from(employments)
    .where(eq(employments.id, row.employmentId))
    .limit(1)
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.TRAINING_ASSIGNMENT_WITHDRAWN,
    summary: `Withdrew "${title}" from ${person?.name ?? 'someone'}`,
    subjectType: 'training_assignment',
    subjectId: row.id,
    locationId: row.locationId ?? allowedAt[0] ?? null,
    metadata: {
      employmentId: row.employmentId,
      courseId: row.courseId,
      previousStatus: row.status,
    },
  })
  await notifyTrainingPeople(
    tx,
    actor.organizationId,
    [
      {
        employmentId: row.employmentId,
        subjectType: 'training_assignment',
        subjectId: row.id,
        title: `No longer needed: ${title}`,
        preview: 'This training was withdrawn. You do not need to finish it.',
        href: '/my/training',
        purpose: 'withdrawn',
      },
    ],
    now,
  )
}

/**
 * Move everyone the actor may assign who has NOT STARTED an older version of
 * this course onto the current one. Anyone who has started stays exactly
 * where they are.
 */
export async function moveNotStartedToCurrent(
  tx: Tx,
  actor: Actor,
  courseId: string,
  now = new Date(),
): Promise<{ moved: number; versionNumber: number }> {
  const { course, version } = await assignableCourse(tx, actor, courseId)
  const scope = scopeFor(actor, ['training.assign'])
  if (scope !== null && scope.length === 0) {
    if (canUseTrainingAdmin(actor)) throw new ForbiddenError('training.assign')
    throw new NotFoundError('Course not found')
  }

  const candidates = await tx
    .select()
    .from(trainingAssignments)
    .where(
      and(
        eq(trainingAssignments.organizationId, actor.organizationId),
        eq(trainingAssignments.courseId, course.id),
        eq(trainingAssignments.status, 'assigned'),
        lt(trainingAssignments.versionNumber, version.versionNumber),
      ),
    )
    .for('update')
  if (candidates.length === 0) return { moved: 0, versionNumber: version.versionNumber }

  const places = await locationNamesFor(
    tx,
    actor.organizationId,
    candidates.map((c) => c.employmentId),
  )
  const inScope = candidates.filter((c) => {
    if (scope === null) return true
    return (places.get(c.employmentId)?.ids ?? []).some((id) => scope.includes(id))
  })

  const moved: AssignmentRow[] = []
  for (const row of inScope) {
    const updated = await tx
      .update(trainingAssignments)
      .set({
        courseVersionId: version.id,
        versionNumber: version.versionNumber,
        previousVersionId: row.courseVersionId,
        updatedAt: now,
      })
      .where(and(eq(trainingAssignments.id, row.id), eq(trainingAssignments.status, 'assigned')))
      .returning({ id: trainingAssignments.id })
    if (updated.length > 0) moved.push(row)
  }

  for (const row of moved) {
    await recordAuditEvent(tx, actor, {
      action: AUDIT_ACTIONS.TRAINING_ASSIGNMENT_VERSION_MOVED,
      summary: `Moved a not-yet-started assignment of "${version.title}" from version ${row.versionNumber} to ${version.versionNumber}`,
      subjectType: 'training_assignment',
      subjectId: row.id,
      locationId: row.locationId,
      metadata: {
        employmentId: row.employmentId,
        fromVersion: row.versionNumber,
        toVersion: version.versionNumber,
      },
    })
  }
  await notifyTrainingPeople(
    tx,
    actor.organizationId,
    moved.map((row) => ({
      employmentId: row.employmentId,
      subjectType: 'training_assignment' as const,
      subjectId: row.id,
      title: `Updated training: ${version.title}`,
      preview: 'This course was updated before you started it, so you have the latest version.',
      href: `/my/training/${row.id}`,
      purpose: `version-${version.versionNumber}`,
    })),
    now,
  )
  return { moved: moved.length, versionNumber: version.versionNumber }
}

/** One more attempt at a knowledge check somebody has run out of attempts on. */
export async function allowAnotherAttempt(
  tx: Tx,
  actor: Actor,
  assignmentId: string,
  lessonId: string,
  now = new Date(),
): Promise<void> {
  const row = await lockAssignment(tx, actor, assignmentId)
  await requirePersonCapability(tx, actor, row.employmentId, 'training.assign')
  if (row.status !== 'assigned' && row.status !== 'in_progress') {
    throw new ValidationError({}, 'This training is no longer open.')
  }
  const [lesson] = await tx
    .select()
    .from(courseLessons)
    .where(
      and(
        eq(courseLessons.organizationId, actor.organizationId),
        eq(courseLessons.id, lessonId),
        eq(courseLessons.versionId, row.courseVersionId),
      ),
    )
    .limit(1)
  const content = lesson ? parseLessonContent(lesson.kind, lesson.content) : null
  if (!lesson || content?.kind !== 'quiz') throw new NotFoundError('Lesson not found')

  const [progress] = await tx
    .select()
    .from(trainingLessonProgress)
    .where(
      and(
        eq(trainingLessonProgress.organizationId, actor.organizationId),
        eq(trainingLessonProgress.assignmentId, row.id),
        eq(trainingLessonProgress.lessonId, lessonId),
      ),
    )
    .for('update')
    .limit(1)
  const [{ used } = { used: 0 }] = await tx
    .select({ used: sql<number>`count(*)::int` })
    .from(trainingQuizAttempts)
    .where(
      and(
        eq(trainingQuizAttempts.organizationId, actor.organizationId),
        eq(trainingQuizAttempts.assignmentId, row.id),
        eq(trainingQuizAttempts.lessonId, lessonId),
      ),
    )
  const allowed = attemptsAllowed(content.maxAttempts, progress?.extraAttempts ?? 0)
  if (!progress || progress.status === 'completed' || allowed === null || used < allowed) {
    throw new ValidationError({}, 'They still have attempts left, so there is nothing to allow.')
  }

  await tx
    .update(trainingLessonProgress)
    .set({ extraAttempts: progress.extraAttempts + 1, updatedAt: now })
    .where(eq(trainingLessonProgress.id, progress.id))
  await syncOnboardingForTraining(tx, actor, [row.id], now)
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.TRAINING_ATTEMPT_ALLOWED,
    summary: `Allowed another attempt at "${lesson.title}"`,
    subjectType: 'training_assignment',
    subjectId: row.id,
    locationId: row.locationId,
    metadata: { employmentId: row.employmentId, lessonId, attemptsAllowed: allowed + 1 },
  })
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export interface AssignmentReportRow {
  assignmentId: string
  employmentId: string
  personName: string
  locationIds: string[]
  locationNames: string[]
  courseId: string
  courseTitle: string
  versionNumber: number
  currentVersionNumber: number | null
  state: AssignmentState
  status: { key: string; label: string; tone: StatusTone }
  percent: number
  completedLessons: number
  totalLessons: number
  awaitingSignoff: number
  required: boolean
  dueOn: string | null
  dueKind: DueKind
  assignedAt: Date
  completedAt: Date | null
  /** Best knowledge-check score, when there is one. */
  bestScore: number | null
  /** Knowledge checks they cannot attempt again without a manager. */
  outOfAttempts: { lessonId: string; lessonTitle: string }[]
}

export interface ReportFilter {
  courseId?: string
  locationId?: string
  employmentId?: string
}

function requireProgressAccess(actor: Actor): void {
  if (canViewProgressAnywhere(actor)) return
  if (canUseTrainingAdmin(actor)) throw new ForbiddenError('training.view_progress_team')
  throw new NotFoundError('Not found')
}

const STATUS_ORDER: Record<string, number> = {
  overdue: 0,
  awaiting_signoff: 1,
  in_progress: 2,
  not_started: 3,
  completed: 4,
  cancelled: 5,
}

/** Open and completed assignments of people within the actor's progress scope. */
export async function scopedAssignments(
  tx: Tx,
  actor: Actor,
  filter: ReportFilter,
  now = new Date(),
): Promise<AssignmentReportRow[]> {
  requireProgressAccess(actor)
  const scope = progressScope(actor)
  if (filter.locationId && scope !== null && !scope.includes(filter.locationId)) {
    throw new NotFoundError('Location not found')
  }
  const locationFilter = filter.locationId ? [filter.locationId] : scope

  let employmentFilter: string[] | null = null
  if (locationFilter !== null) {
    if (locationFilter.length === 0) return []
    const rows = await tx
      .selectDistinct({ employmentId: employmentLocations.employmentId })
      .from(employmentLocations)
      .where(
        and(
          eq(employmentLocations.organizationId, actor.organizationId),
          inArray(employmentLocations.locationId, locationFilter),
        ),
      )
    employmentFilter = rows.map((r) => r.employmentId)
    if (employmentFilter.length === 0) return []
  }
  if (filter.employmentId) {
    if (employmentFilter !== null && !employmentFilter.includes(filter.employmentId)) {
      throw new NotFoundError('Person not found')
    }
    employmentFilter = [filter.employmentId]
  }

  const rows = await tx
    .select()
    .from(trainingAssignments)
    .where(
      and(
        eq(trainingAssignments.organizationId, actor.organizationId),
        ne(trainingAssignments.status, 'cancelled'),
        filter.courseId ? eq(trainingAssignments.courseId, filter.courseId) : undefined,
        employmentFilter ? inArray(trainingAssignments.employmentId, employmentFilter) : undefined,
      ),
    )
  if (rows.length === 0) return []

  const employmentIds = rows.map((r) => r.employmentId)
  const [progress, places, zones, people, courseRows, versionRows, scores, quizProgress] =
    await Promise.all([
      progressFor(tx, actor.organizationId, rows),
      locationNamesFor(tx, actor.organizationId, employmentIds),
      timeZonesFor(tx, actor.organizationId, employmentIds),
      tx
        .select({ id: employments.id, name: employments.displayName })
        .from(employments)
        .where(
          and(
            eq(employments.organizationId, actor.organizationId),
            inArray(employments.id, [...new Set(employmentIds)]),
          ),
        ),
      tx
        .select({ id: courses.id, publishedVersionId: courses.publishedVersionId })
        .from(courses)
        .where(
          and(
            eq(courses.organizationId, actor.organizationId),
            inArray(courses.id, [...new Set(rows.map((r) => r.courseId))]),
          ),
        ),
      tx
        .select({
          id: courseVersions.id,
          title: courseVersions.title,
          versionNumber: courseVersions.versionNumber,
        })
        .from(courseVersions)
        .where(
          and(
            eq(courseVersions.organizationId, actor.organizationId),
            inArray(courseVersions.courseId, [...new Set(rows.map((r) => r.courseId))]),
          ),
        ),
      tx
        .select({
          assignmentId: trainingQuizAttempts.assignmentId,
          lessonId: trainingQuizAttempts.lessonId,
          attempts: sql<number>`count(*)::int`,
          best: sql<number>`max(${trainingQuizAttempts.scorePercent})::int`,
          passed: sql<boolean>`bool_or(${trainingQuizAttempts.passed})`,
        })
        .from(trainingQuizAttempts)
        .where(
          and(
            eq(trainingQuizAttempts.organizationId, actor.organizationId),
            inArray(
              trainingQuizAttempts.assignmentId,
              rows.map((r) => r.id),
            ),
          ),
        )
        .groupBy(trainingQuizAttempts.assignmentId, trainingQuizAttempts.lessonId),
      tx
        .select({
          assignmentId: trainingLessonProgress.assignmentId,
          lessonId: trainingLessonProgress.lessonId,
          extraAttempts: trainingLessonProgress.extraAttempts,
        })
        .from(trainingLessonProgress)
        .where(
          and(
            eq(trainingLessonProgress.organizationId, actor.organizationId),
            inArray(
              trainingLessonProgress.assignmentId,
              rows.map((r) => r.id),
            ),
          ),
        ),
    ])

  const nameById = new Map(people.map((p) => [p.id, p.name]))
  const versionById = new Map(versionRows.map((v) => [v.id, v]))
  const currentByCourse = new Map(
    courseRows.map((c) => [
      c.id,
      c.publishedVersionId ? (versionById.get(c.publishedVersionId)?.versionNumber ?? null) : null,
    ]),
  )

  // Attempt limits live in lesson content; load only the quiz lessons involved.
  const quizLessonIds = [...new Set(scores.filter((s) => !s.passed).map((s) => s.lessonId))]
  const quizLessons =
    quizLessonIds.length === 0
      ? []
      : await tx
          .select({
            id: courseLessons.id,
            title: courseLessons.title,
            kind: courseLessons.kind,
            content: courseLessons.content,
          })
          .from(courseLessons)
          .where(
            and(
              eq(courseLessons.organizationId, actor.organizationId),
              inArray(courseLessons.id, quizLessonIds),
            ),
          )

  const out = rows.map((row): AssignmentReportRow => {
    const p = progress.get(row.id)!
    const today = businessDate(now, zones.zones.get(row.employmentId) ?? zones.fallback)
    const due = dueStatus(row.dueOn, today, p.state === 'completed')
    const mine = scores.filter((s) => s.assignmentId === row.id)
    const outOfAttempts = mine
      .filter((s) => !s.passed)
      .flatMap((s) => {
        const lesson = quizLessons.find((l) => l.id === s.lessonId)
        if (!lesson) return []
        const content = parseLessonContent(lesson.kind, lesson.content)
        if (content.kind !== 'quiz') return []
        const extra =
          quizProgress.find((q) => q.assignmentId === row.id && q.lessonId === s.lessonId)
            ?.extraAttempts ?? 0
        const allowed = attemptsAllowed(content.maxAttempts, extra)
        return allowed !== null && s.attempts >= allowed
          ? [{ lessonId: lesson.id, lessonTitle: lesson.title }]
          : []
      })
    return {
      assignmentId: row.id,
      employmentId: row.employmentId,
      personName: nameById.get(row.employmentId) ?? 'Unknown',
      locationIds: places.get(row.employmentId)?.ids ?? [],
      locationNames: places.get(row.employmentId)?.names ?? [],
      courseId: row.courseId,
      courseTitle: versionById.get(row.courseVersionId)?.title ?? 'Training',
      versionNumber: row.versionNumber,
      currentVersionNumber: currentByCourse.get(row.courseId) ?? null,
      state: p.state,
      status: managerStatus(p.state, due),
      percent: p.percent,
      completedLessons: p.completed,
      totalLessons: p.total,
      awaitingSignoff: p.awaitingSignoff,
      required: row.required,
      dueOn: row.dueOn,
      dueKind: due.kind,
      assignedAt: row.assignedAt,
      completedAt: row.completedAt,
      bestScore: mine.length > 0 ? Math.max(...mine.map((s) => s.best)) : null,
      outOfAttempts,
    }
  })

  return out.sort(
    (a, b) =>
      (STATUS_ORDER[a.status.key] ?? 9) - (STATUS_ORDER[b.status.key] ?? 9) ||
      (a.dueOn ?? '9999').localeCompare(b.dueOn ?? '9999') ||
      a.personName.localeCompare(b.personName),
  )
}

export interface StatusCounts {
  total: number
  notStarted: number
  inProgress: number
  awaitingSignoff: number
  overdue: number
  completed: number
}

export function countStatuses(rows: readonly AssignmentReportRow[]): StatusCounts {
  const counts: StatusCounts = {
    total: rows.length,
    notStarted: 0,
    inProgress: 0,
    awaitingSignoff: 0,
    overdue: 0,
    completed: 0,
  }
  for (const row of rows) {
    if (row.status.key === 'not_started') counts.notStarted += 1
    else if (row.status.key === 'in_progress') counts.inProgress += 1
    else if (row.status.key === 'awaiting_signoff') counts.awaitingSignoff += 1
    else if (row.status.key === 'overdue') counts.overdue += 1
    else if (row.status.key === 'completed') counts.completed += 1
  }
  return counts
}

/** Locations whose people's progress the actor can read. */
export async function progressLocations(tx: Tx, actor: Actor): Promise<LocationRef[]> {
  if (can(actor, 'training.view_progress_org')) {
    return locationsWhere(tx, actor, 'training.view_progress_org')
  }
  return locationsWhere(tx, actor, 'training.view_progress_team')
}

export interface TrainingOverview {
  counts: StatusCounts & { completedLast30Days: number }
  courses: { courseId: string; title: string; counts: StatusCounts }[]
}

export async function trainingOverview(
  tx: Tx,
  actor: Actor,
  now = new Date(),
): Promise<TrainingOverview | null> {
  if (!canViewProgressAnywhere(actor)) return null
  const rows = await scopedAssignments(tx, actor, {}, now)
  const monthAgo = now.getTime() - 30 * 86_400_000
  const byCourse = new Map<string, AssignmentReportRow[]>()
  for (const row of rows) byCourse.set(row.courseId, [...(byCourse.get(row.courseId) ?? []), row])
  return {
    counts: {
      ...countStatuses(rows),
      completedLast30Days: rows.filter(
        (r) => r.completedAt !== null && r.completedAt.getTime() >= monthAgo,
      ).length,
    },
    courses: [...byCourse.entries()].map(([courseId, list]) => ({
      courseId,
      title: list[0]!.courseTitle,
      counts: countStatuses(list),
    })),
  }
}

// ---------------------------------------------------------------------------
// Practical sign-off
// ---------------------------------------------------------------------------

export interface SignoffRequest {
  progressId: string
  assignmentId: string
  employmentId: string
  personName: string
  locationNames: string[]
  courseTitle: string
  versionNumber: number
  lessonId: string
  lessonTitle: string
  body: string
  criteria: ContentItem[]
  requestedAt: Date | null
  waitingDays: number
  previous: { decision: string; note: string; byName: string; at: Date }[]
}

/**
 * Practicals waiting for the actor to sign off, oldest first. Their own
 * requests are never in their queue: somebody else signs those off.
 */
export async function signoffQueue(
  tx: Tx,
  actor: Actor,
  now = new Date(),
): Promise<SignoffRequest[]> {
  const scope = scopeFor(actor, ['skill.verify'])
  if (scope !== null && scope.length === 0) {
    if (canUseTrainingAdmin(actor)) throw new ForbiddenError('skill.verify')
    throw new NotFoundError('Not found')
  }

  const waiting = await tx
    .select()
    .from(trainingLessonProgress)
    .where(
      and(
        eq(trainingLessonProgress.organizationId, actor.organizationId),
        eq(trainingLessonProgress.status, 'awaiting_signoff'),
        ne(trainingLessonProgress.employmentId, actor.employmentId),
      ),
    )
    .orderBy(asc(trainingLessonProgress.signoffRequestedAt))
  if (waiting.length === 0) return []

  const places = await locationNamesFor(
    tx,
    actor.organizationId,
    waiting.map((w) => w.employmentId),
  )
  const visible = waiting.filter(
    (w) =>
      scope === null || (places.get(w.employmentId)?.ids ?? []).some((id) => scope.includes(id)),
  )
  if (visible.length === 0) return []

  const [assignments, lessons, people, history] = await Promise.all([
    tx
      .select()
      .from(trainingAssignments)
      .where(
        and(
          eq(trainingAssignments.organizationId, actor.organizationId),
          inArray(
            trainingAssignments.id,
            visible.map((v) => v.assignmentId),
          ),
          inArray(trainingAssignments.status, ['assigned', 'in_progress']),
        ),
      ),
    tx
      .select()
      .from(courseLessons)
      .where(
        and(
          eq(courseLessons.organizationId, actor.organizationId),
          inArray(
            courseLessons.id,
            visible.map((v) => v.lessonId),
          ),
        ),
      ),
    tx
      .select({ id: employments.id, name: employments.displayName })
      .from(employments)
      .where(eq(employments.organizationId, actor.organizationId)),
    tx
      .select()
      .from(trainingSignoffs)
      .where(
        and(
          eq(trainingSignoffs.organizationId, actor.organizationId),
          inArray(
            trainingSignoffs.progressId,
            visible.map((v) => v.id),
          ),
        ),
      )
      .orderBy(desc(trainingSignoffs.decidedAt)),
  ])
  const titles = await tx
    .select({ id: courseVersions.id, title: courseVersions.title })
    .from(courseVersions)
    .where(
      and(
        eq(courseVersions.organizationId, actor.organizationId),
        inArray(
          courseVersions.id,
          assignments.map((a) => a.courseVersionId),
        ),
      ),
    )
  const nameById = new Map(people.map((p) => [p.id, p.name]))

  return visible.flatMap((w): SignoffRequest[] => {
    const assignment = assignments.find((a) => a.id === w.assignmentId)
    const lesson = lessons.find((l) => l.id === w.lessonId)
    if (!assignment || !lesson) return []
    const content = parseLessonContent(lesson.kind, lesson.content)
    return [
      {
        progressId: w.id,
        assignmentId: w.assignmentId,
        employmentId: w.employmentId,
        personName: nameById.get(w.employmentId) ?? 'Unknown',
        locationNames: places.get(w.employmentId)?.names ?? [],
        courseTitle: titles.find((t) => t.id === assignment.courseVersionId)?.title ?? 'Training',
        versionNumber: assignment.versionNumber,
        lessonId: lesson.id,
        lessonTitle: lesson.title,
        body: lesson.body,
        criteria: content.kind === 'practical' ? content.criteria : [],
        requestedAt: w.signoffRequestedAt,
        waitingDays: w.signoffRequestedAt
          ? Math.max(
              0,
              daysBetween(
                w.signoffRequestedAt.toISOString().slice(0, 10),
                now.toISOString().slice(0, 10),
              ),
            )
          : 0,
        previous: history
          .filter((h) => h.progressId === w.id)
          .map((h) => ({
            decision: h.decision,
            note: h.note,
            byName: nameById.get(h.decidedByEmploymentId) ?? 'A manager',
            at: h.decidedAt,
          })),
      },
    ]
  })
}

export async function decideSignoff(
  tx: Tx,
  actor: Actor,
  progressId: string,
  input: { decision: string; note: string; criteriaConfirmed: readonly string[] },
  now = new Date(),
): Promise<{ decision: 'verified' | 'returned'; courseComplete: boolean; personName: string }> {
  const [progress] = await tx
    .select()
    .from(trainingLessonProgress)
    .where(
      and(
        eq(trainingLessonProgress.organizationId, actor.organizationId),
        eq(trainingLessonProgress.id, progressId),
      ),
    )
    .for('update')
    .limit(1)
  if (!progress) throw new NotFoundError('Sign-off not found')
  if (progress.employmentId === actor.employmentId) {
    throw new ForbiddenError('skill.verify', 'Someone else needs to sign off your own practical.')
  }
  const allowedAt = await requirePersonCapability(tx, actor, progress.employmentId, 'skill.verify')

  if (progress.status !== 'awaiting_signoff') {
    throw new ValidationError({}, 'This has already been decided.')
  }
  const assignment = await lockAssignment(tx, actor, progress.assignmentId)
  if (assignment.status !== 'assigned' && assignment.status !== 'in_progress') {
    throw new ValidationError({}, 'This training is no longer open.')
  }
  const [lesson] = await tx
    .select()
    .from(courseLessons)
    .where(eq(courseLessons.id, progress.lessonId))
    .limit(1)
  const content = lesson ? parseLessonContent(lesson.kind, lesson.content) : null
  if (!lesson || content?.kind !== 'practical') throw new NotFoundError('Sign-off not found')

  const decision =
    input.decision === 'verified' ? 'verified' : input.decision === 'returned' ? 'returned' : null
  if (!decision) throw new ValidationError({ decision: ['Choose to sign it off or send it back.'] })
  const note = cleanNote(input.note)
  const criteria = content.criteria.map((c) => c.id)
  const confirmed = [...new Set(input.criteriaConfirmed.filter((id) => criteria.includes(id)))]

  if (decision === 'verified' && confirmed.length !== criteria.length) {
    throw new ValidationError(
      { criteria: ['Confirm every point before signing off, or send it back with a note.'] },
      'Confirm every point before signing off.',
    )
  }
  if (decision === 'returned' && !note) {
    throw new ValidationError(
      { note: ['Say what to practise, so they know what to work on.'] },
      'Add a note saying what to practise.',
    )
  }

  const signoffId = newId()
  await tx.insert(trainingSignoffs).values({
    id: signoffId,
    organizationId: actor.organizationId,
    progressId: progress.id,
    assignmentId: assignment.id,
    lessonId: lesson.id,
    employmentId: progress.employmentId,
    decision,
    note,
    criteriaConfirmed: confirmed,
    decidedByEmploymentId: actor.employmentId,
    decidedAt: now,
  })
  await tx
    .update(trainingLessonProgress)
    .set(
      decision === 'verified'
        ? { status: 'completed', completedAt: now, updatedAt: now }
        : { status: 'returned', updatedAt: now },
    )
    .where(eq(trainingLessonProgress.id, progress.id))

  const title = await versionTitle(tx, assignment.courseVersionId)
  const [person] = await tx
    .select({ name: employments.displayName })
    .from(employments)
    .where(eq(employments.id, progress.employmentId))
    .limit(1)
  const personName = person?.name ?? 'Someone'

  await recordAuditEvent(tx, actor, {
    action:
      decision === 'verified'
        ? AUDIT_ACTIONS.TRAINING_SIGNOFF_VERIFIED
        : AUDIT_ACTIONS.TRAINING_SIGNOFF_RETURNED,
    summary:
      decision === 'verified'
        ? `Signed off "${lesson.title}" for ${personName}`
        : `Sent "${lesson.title}" back to ${personName} to practise`,
    subjectType: 'training_assignment',
    subjectId: assignment.id,
    locationId: assignment.locationId ?? allowedAt[0] ?? null,
    metadata: { employmentId: progress.employmentId, lessonId: lesson.id, signoffId },
  })

  const settled =
    decision === 'verified'
      ? await settleAssignment(tx, actor, assignment, title, now)
      : { justCompleted: false }
  await syncOnboardingForTraining(tx, actor, [assignment.id], now)

  await notifyTrainingPeople(
    tx,
    actor.organizationId,
    [
      {
        employmentId: progress.employmentId,
        subjectType: 'training_signoff',
        subjectId: signoffId,
        title:
          decision === 'verified'
            ? `Signed off: ${lesson.title}`
            : `Not signed off yet: ${lesson.title}`,
        preview:
          decision === 'verified'
            ? settled.justCompleted
              ? `${actor.displayName} signed you off, and that completes ${title}.`
              : `${actor.displayName} signed you off.`
            : `${actor.displayName} left a note on what to practise.`,
        href: `/my/training/${assignment.id}/lessons/${lesson.id}`,
        purpose: 'decision',
      },
    ],
    now,
  )

  return { decision, courseComplete: settled.justCompleted, personName }
}
