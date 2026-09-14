import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { Tx } from '@/server/db'
import { employmentLocations, employments, locations, organizations } from '@/server/db/schema'
import type { Actor } from '@/server/authz'
import { AUDIT_ACTIONS, recordAuditEvent } from '@/server/audit'
import { businessDate } from '@/lib/dates'
import { attemptsAllowed, isLessonKind, parseLessonContent } from './content'
import { courseProgress, type CourseProgress, type ProgressLesson } from './progress'
import {
  courseLessons,
  trainingAssignments,
  trainingLessonProgress,
  trainingQuizAttempts,
} from './schema'

/*
 * Shared loading for assignments: their lessons, their progress, and the
 * calendar date it is for the person, so "due today" means today where they
 * work rather than wherever the server is.
 */

export type AssignmentRow = typeof trainingAssignments.$inferSelect

export async function lessonsByVersion(
  tx: Tx,
  organizationId: string,
  versionIds: readonly string[],
): Promise<Map<string, (ProgressLesson & { versionId: string })[]>> {
  const out = new Map<string, (ProgressLesson & { versionId: string })[]>()
  const ids = [...new Set(versionIds)]
  if (ids.length === 0) return out
  const rows = await tx
    .select({
      id: courseLessons.id,
      versionId: courseLessons.versionId,
      title: courseLessons.title,
      kind: courseLessons.kind,
      position: courseLessons.position,
      estimatedMinutes: courseLessons.estimatedMinutes,
    })
    .from(courseLessons)
    .where(
      and(eq(courseLessons.organizationId, organizationId), inArray(courseLessons.versionId, ids)),
    )
    .orderBy(asc(courseLessons.position))
  for (const row of rows) {
    const lesson = {
      ...row,
      kind: isLessonKind(row.kind) ? row.kind : 'reading',
    }
    out.set(row.versionId, [...(out.get(row.versionId) ?? []), lesson])
  }
  return out
}

/** Progress for many assignments in a fixed number of queries. */
export async function progressFor(
  tx: Tx,
  organizationId: string,
  assignments: readonly AssignmentRow[],
): Promise<Map<string, CourseProgress>> {
  const out = new Map<string, CourseProgress>()
  if (assignments.length === 0) return out
  const lessons = await lessonsByVersion(
    tx,
    organizationId,
    assignments.map((a) => a.courseVersionId),
  )
  const records = await tx
    .select({
      assignmentId: trainingLessonProgress.assignmentId,
      lessonId: trainingLessonProgress.lessonId,
      status: trainingLessonProgress.status,
    })
    .from(trainingLessonProgress)
    .where(
      and(
        eq(trainingLessonProgress.organizationId, organizationId),
        inArray(
          trainingLessonProgress.assignmentId,
          assignments.map((a) => a.id),
        ),
      ),
    )
  const byAssignment = new Map<string, { lessonId: string; status: string }[]>()
  for (const r of records) {
    byAssignment.set(r.assignmentId, [...(byAssignment.get(r.assignmentId) ?? []), r])
  }
  for (const assignment of assignments) {
    out.set(
      assignment.id,
      courseProgress(
        lessons.get(assignment.courseVersionId) ?? [],
        byAssignment.get(assignment.id) ?? [],
        assignment.status,
      ),
    )
  }
  return out
}

/** Each person's timezone: their home location's, else the organization's. */
export async function timeZonesFor(
  tx: Tx,
  organizationId: string,
  employmentIds: readonly string[],
): Promise<{ zones: Map<string, string>; fallback: string }> {
  const [org] = await tx
    .select({ timezone: organizations.timezone })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1)
  const fallback = org?.timezone ?? 'UTC'
  const zones = new Map<string, string>()
  const ids = [...new Set(employmentIds)]
  if (ids.length === 0) return { zones, fallback }
  const rows = await tx
    .select({ id: employments.id, timezone: locations.timezone })
    .from(employments)
    .leftJoin(
      locations,
      and(
        eq(locations.organizationId, employments.organizationId),
        eq(locations.id, employments.homeLocationId),
      ),
    )
    .where(and(eq(employments.organizationId, organizationId), inArray(employments.id, ids)))
  for (const row of rows) zones.set(row.id, row.timezone ?? fallback)
  return { zones, fallback }
}

export async function timeZoneOf(
  tx: Tx,
  organizationId: string,
  employmentId: string,
): Promise<string> {
  const { zones, fallback } = await timeZonesFor(tx, organizationId, [employmentId])
  return zones.get(employmentId) ?? fallback
}

export async function organizationTimeZone(tx: Tx, organizationId: string): Promise<string> {
  return (await timeZonesFor(tx, organizationId, [])).fallback
}

export async function todayFor(
  tx: Tx,
  organizationId: string,
  employmentId: string,
  now: Date,
): Promise<string> {
  return businessDate(now, await timeZoneOf(tx, organizationId, employmentId))
}

export async function locationNamesFor(
  tx: Tx,
  organizationId: string,
  employmentIds: readonly string[],
): Promise<Map<string, { ids: string[]; names: string[] }>> {
  const out = new Map<string, { ids: string[]; names: string[] }>()
  const ids = [...new Set(employmentIds)]
  if (ids.length === 0) return out
  const rows = await tx
    .select({
      employmentId: employmentLocations.employmentId,
      locationId: locations.id,
      name: locations.name,
    })
    .from(employmentLocations)
    .innerJoin(
      locations,
      and(
        eq(locations.organizationId, employmentLocations.organizationId),
        eq(locations.id, employmentLocations.locationId),
      ),
    )
    .where(
      and(
        eq(employmentLocations.organizationId, organizationId),
        inArray(employmentLocations.employmentId, ids),
      ),
    )
    .orderBy(asc(locations.name))
  for (const row of rows) {
    const entry = out.get(row.employmentId) ?? { ids: [], names: [] }
    entry.ids.push(row.locationId)
    entry.names.push(row.name)
    out.set(row.employmentId, entry)
  }
  return out
}

/**
 * Bring an assignment's status in line with its lessons, after anything that
 * changes progress. Started on the first action; completed when every lesson
 * is done - including a practical a manager has just signed off, which is why
 * the actor here is not always the learner.
 */
export async function settleAssignment(
  tx: Tx,
  actor: Actor,
  assignment: AssignmentRow,
  courseTitle: string,
  now: Date,
): Promise<{ progress: CourseProgress; justCompleted: boolean }> {
  const progress = (
    await progressFor(tx, assignment.organizationId, [
      { ...assignment, status: assignment.status === 'completed' ? 'completed' : 'in_progress' },
    ])
  ).get(assignment.id)!

  if (assignment.status === 'assigned' || assignment.status === 'in_progress') {
    const finished = progress.total > 0 && progress.completed === progress.total
    if (finished) {
      await tx
        .update(trainingAssignments)
        .set({
          status: 'completed',
          startedAt: assignment.startedAt ?? now,
          completedAt: now,
          updatedAt: now,
        })
        .where(eq(trainingAssignments.id, assignment.id))
      const [person] = await tx
        .select({ name: employments.displayName })
        .from(employments)
        .where(eq(employments.id, assignment.employmentId))
        .limit(1)
      await recordAuditEvent(tx, actor, {
        action: AUDIT_ACTIONS.TRAINING_COMPLETED,
        summary: `${person?.name ?? 'Someone'} completed "${courseTitle}" (version ${assignment.versionNumber})`,
        subjectType: 'training_assignment',
        subjectId: assignment.id,
        locationId: assignment.locationId,
        metadata: {
          employmentId: assignment.employmentId,
          courseId: assignment.courseId,
          versionNumber: assignment.versionNumber,
          lessons: progress.total,
        },
      })
      return { progress: { ...progress, state: 'completed' }, justCompleted: true }
    }
    if (assignment.status === 'assigned') {
      await tx
        .update(trainingAssignments)
        .set({ status: 'in_progress', startedAt: now, updatedAt: now })
        .where(eq(trainingAssignments.id, assignment.id))
    }
  }
  return { progress, justCompleted: false }
}

/**
 * Knowledge checks each assignment can no longer attempt without a manager:
 * not passed, and every allowed attempt used.
 */
export async function outOfAttemptsFor(
  tx: Tx,
  organizationId: string,
  assignmentIds: readonly string[],
): Promise<Map<string, { lessonId: string; lessonTitle: string }[]>> {
  const out = new Map<string, { lessonId: string; lessonTitle: string }[]>()
  const ids = [...new Set(assignmentIds)]
  if (ids.length === 0) return out
  const attempts = await tx
    .select({
      assignmentId: trainingQuizAttempts.assignmentId,
      lessonId: trainingQuizAttempts.lessonId,
      used: sql<number>`count(*)::int`,
      passed: sql<boolean>`bool_or(${trainingQuizAttempts.passed})`,
    })
    .from(trainingQuizAttempts)
    .where(
      and(
        eq(trainingQuizAttempts.organizationId, organizationId),
        inArray(trainingQuizAttempts.assignmentId, ids),
      ),
    )
    .groupBy(trainingQuizAttempts.assignmentId, trainingQuizAttempts.lessonId)
  const unpassed = attempts.filter((a) => !a.passed)
  if (unpassed.length === 0) return out

  const lessons = await tx
    .select({
      id: courseLessons.id,
      title: courseLessons.title,
      kind: courseLessons.kind,
      content: courseLessons.content,
    })
    .from(courseLessons)
    .where(
      and(
        eq(courseLessons.organizationId, organizationId),
        inArray(courseLessons.id, [...new Set(unpassed.map((a) => a.lessonId))]),
      ),
    )
  const extras = await tx
    .select({
      assignmentId: trainingLessonProgress.assignmentId,
      lessonId: trainingLessonProgress.lessonId,
      extraAttempts: trainingLessonProgress.extraAttempts,
    })
    .from(trainingLessonProgress)
    .where(
      and(
        eq(trainingLessonProgress.organizationId, organizationId),
        inArray(trainingLessonProgress.assignmentId, ids),
      ),
    )

  for (const attempt of unpassed) {
    const lesson = lessons.find((l) => l.id === attempt.lessonId)
    if (!lesson) continue
    const content = parseLessonContent(lesson.kind, lesson.content)
    if (content.kind !== 'quiz') continue
    const extra =
      extras.find((e) => e.assignmentId === attempt.assignmentId && e.lessonId === attempt.lessonId)
        ?.extraAttempts ?? 0
    const allowed = attemptsAllowed(content.maxAttempts, extra)
    if (allowed !== null && attempt.used >= allowed) {
      out.set(attempt.assignmentId, [
        ...(out.get(attempt.assignmentId) ?? []),
        { lessonId: lesson.id, lessonTitle: lesson.title },
      ])
    }
  }
  return out
}
