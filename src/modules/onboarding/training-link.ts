import { and, desc, eq, inArray, ne } from 'drizzle-orm'
import type { Tx } from '@/server/db'
import {
  courseVersions,
  courses,
  employments,
  onboardingAssignments,
  onboardingStepProgress,
  trainingAssignments,
} from '@/server/db/schema'
import type { Actor } from '@/server/authz/actor'
import { AUDIT_ACTIONS, recordAuditEvent } from '@/server/audit'
import { newId } from '@/lib/ids'
import { formatCalendarDate, formatDateInZone } from '@/lib/dates'
import { notifyTrainingPeople } from '@/modules/training/notify'
import { outOfAttemptsFor, progressFor, timeZoneOf } from '@/modules/training/records'
import { refreshOnboardingCompletion } from './completion'

/*
 * ONBOARDING <-> TRAINING.
 *
 * A `training_assignment` step names a published course. When onboarding
 * starts, the step is linked to exactly one training ASSIGNMENT, and from
 * then on the step follows it:
 *
 *   course completed                 step completed (by the person, recorded)
 *   practical waiting for sign-off   step pending, shown as waiting
 *   out of quiz attempts             step blocked, saying a manager can help
 *   course withdrawn                 step blocked, saying it was withdrawn
 *   anything else                    step pending
 *
 * Completion is one-way. A completed step is never reopened by anything that
 * happens later in Training, and nothing here completes a step the course has
 * not completed.
 *
 * Which assignment a step links to, decided once when onboarding starts:
 *
 *   1. an OPEN assignment of that course for the person, on whatever version
 *      it is on - never replaced, never duplicated;
 *   2. otherwise their most recent COMPLETED one - the course is already done;
 *   3. otherwise a NEW assignment of the currently published version, source
 *      `onboarding`, due when the step is due;
 *   4. and if the course has since been archived or unpublished, nothing is
 *      assigned and the step is blocked with that reason.
 *
 * A newer published version later changes nothing: the assignment keeps its
 * pinned version, exactly as any other assignment does. Assigning the course
 * again after a withdrawal relinks the step to the new assignment.
 */

export type LinkedTrainingState =
  | 'not_started'
  | 'in_progress'
  | 'awaiting_signoff'
  | 'completed'
  | 'blocked'
  | 'withdrawn'
  | 'unavailable'

export interface LinkedTraining {
  courseId: string
  courseTitle: string
  assignmentId: string | null
  versionNumber: number | null
  state: LinkedTrainingState
  completedLessons: number
  totalLessons: number
  percent: number
  nextLessonId: string | null
}

const OPEN_STATUSES = ['assigned', 'in_progress']

export const UNLINKED_TRAINING_REASON =
  'No course is linked to this step. A manager can assign the course under Training.'

export interface StepToLink {
  progressId: string
  courseId: string
  stepTitle: string
  dueOn: string | null
}

/** Link each training step of a run that has just started. */
export async function linkTrainingOnStart(
  tx: Tx,
  actor: Actor,
  input: { employmentId: string; locationId: string | null; steps: readonly StepToLink[] },
  now = new Date(),
): Promise<void> {
  if (input.steps.length === 0) return
  const organizationId = actor.organizationId
  const linked = new Set<string>()

  for (const step of input.steps) {
    const [course] = await tx
      .select({
        id: courses.id,
        title: courses.title,
        status: courses.status,
        publishedVersionId: courses.publishedVersionId,
        versionTitle: courseVersions.title,
        versionNumber: courseVersions.versionNumber,
      })
      .from(courses)
      .leftJoin(
        courseVersions,
        and(
          eq(courseVersions.organizationId, courses.organizationId),
          eq(courseVersions.id, courses.publishedVersionId),
        ),
      )
      .where(and(eq(courses.organizationId, organizationId), eq(courses.id, step.courseId)))
      .limit(1)

    const existing = await tx
      .select({ id: trainingAssignments.id, status: trainingAssignments.status })
      .from(trainingAssignments)
      .where(
        and(
          eq(trainingAssignments.organizationId, organizationId),
          eq(trainingAssignments.employmentId, input.employmentId),
          eq(trainingAssignments.courseId, step.courseId),
        ),
      )
      .orderBy(desc(trainingAssignments.assignedAt))

    let assignmentId =
      existing.find((a) => OPEN_STATUSES.includes(a.status))?.id ??
      existing.find((a) => a.status === 'completed')?.id ??
      null

    if (!assignmentId && course && course.status === 'active' && course.publishedVersionId) {
      assignmentId = await assignForOnboarding(
        tx,
        actor,
        {
          employmentId: input.employmentId,
          locationId: input.locationId,
          courseId: course.id,
          versionId: course.publishedVersionId,
          versionNumber: course.versionNumber!,
          title: course.versionTitle ?? course.title,
          dueOn: step.dueOn,
        },
        now,
      )
    }

    if (!assignmentId) {
      const title = course?.versionTitle ?? course?.title ?? 'The linked course'
      await tx
        .update(onboardingStepProgress)
        .set({
          status: 'blocked',
          blockedReason: `“${title}” is ${course?.status === 'archived' ? 'archived' : 'not published'}, so it could not be assigned. A manager can assign a course under Training.`,
          updatedAt: now,
        })
        .where(eq(onboardingStepProgress.id, step.progressId))
      continue
    }

    await tx
      .update(onboardingStepProgress)
      .set({ trainingAssignmentId: assignmentId, updatedAt: now })
      .where(eq(onboardingStepProgress.id, step.progressId))
    linked.add(assignmentId)
  }

  await syncOnboardingForTraining(tx, actor, [...linked], now)
}

async function assignForOnboarding(
  tx: Tx,
  actor: Actor,
  input: {
    employmentId: string
    locationId: string | null
    courseId: string
    versionId: string
    versionNumber: number
    title: string
    dueOn: string | null
  },
  now: Date,
): Promise<string> {
  const id = newId()
  const inserted = await tx
    .insert(trainingAssignments)
    .values({
      id,
      organizationId: actor.organizationId,
      employmentId: input.employmentId,
      courseId: input.courseId,
      courseVersionId: input.versionId,
      versionNumber: input.versionNumber,
      locationId: input.locationId,
      source: 'onboarding',
      required: true,
      dueOn: input.dueOn,
      assignedByEmploymentId: actor.employmentId,
      assignedAt: now,
    })
    // Two onboarding starts racing converge on one open assignment.
    .onConflictDoNothing()
    .returning({ id: trainingAssignments.id })

  if (inserted.length === 0) {
    const [open] = await tx
      .select({ id: trainingAssignments.id })
      .from(trainingAssignments)
      .where(
        and(
          eq(trainingAssignments.organizationId, actor.organizationId),
          eq(trainingAssignments.employmentId, input.employmentId),
          eq(trainingAssignments.courseId, input.courseId),
          inArray(trainingAssignments.status, OPEN_STATUSES),
        ),
      )
      .limit(1)
    return open!.id
  }

  const [person] = await tx
    .select({ name: employments.displayName })
    .from(employments)
    .where(eq(employments.id, input.employmentId))
    .limit(1)
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.TRAINING_ASSIGNED,
    summary: `Assigned "${input.title}" (version ${input.versionNumber}) to ${person?.name ?? 'someone'} as part of onboarding`,
    subjectType: 'training_assignment',
    subjectId: id,
    locationId: input.locationId,
    metadata: {
      employmentId: input.employmentId,
      courseId: input.courseId,
      versionNumber: input.versionNumber,
      dueOn: input.dueOn,
      source: 'onboarding',
    },
  })
  await notifyTrainingPeople(
    tx,
    actor.organizationId,
    [
      {
        employmentId: input.employmentId,
        subjectType: 'training_assignment',
        subjectId: id,
        title: `New training: ${input.title}`,
        preview: input.dueOn
          ? `Part of your onboarding, due ${formatCalendarDate(input.dueOn)}.`
          : 'Part of your onboarding.',
        href: `/my/training/${id}`,
        purpose: 'assigned',
      },
    ],
    now,
  )
  return id
}

/**
 * After a new assignment of a course, point any of the person's onboarding
 * steps for that course that lost their assignment (withdrawn, or never
 * assigned) at the new one.
 */
export async function relinkOnboardingSteps(
  tx: Tx,
  actor: Actor,
  input: { employmentId: string; courseId: string; trainingAssignmentId: string },
  now = new Date(),
): Promise<void> {
  const organizationId = actor.organizationId
  const runs = await tx
    .select({ id: onboardingAssignments.id })
    .from(onboardingAssignments)
    .where(
      and(
        eq(onboardingAssignments.organizationId, organizationId),
        eq(onboardingAssignments.employmentId, input.employmentId),
      ),
    )
  if (runs.length === 0) return

  const steps = await tx
    .select({
      id: onboardingStepProgress.id,
      trainingAssignmentId: onboardingStepProgress.trainingAssignmentId,
    })
    .from(onboardingStepProgress)
    .where(
      and(
        eq(onboardingStepProgress.organizationId, organizationId),
        inArray(
          onboardingStepProgress.assignmentId,
          runs.map((r) => r.id),
        ),
        eq(onboardingStepProgress.courseId, input.courseId),
        ne(onboardingStepProgress.status, 'completed'),
      ),
    )
  if (steps.length === 0) return

  const current = await tx
    .select({ id: trainingAssignments.id, status: trainingAssignments.status })
    .from(trainingAssignments)
    .where(
      and(
        eq(trainingAssignments.organizationId, organizationId),
        inArray(trainingAssignments.id, [
          ...new Set(steps.map((s) => s.trainingAssignmentId).filter((id): id is string => !!id)),
          input.trainingAssignmentId,
        ]),
      ),
    )
  const statusOf = new Map(current.map((c) => [c.id, c.status]))

  let changed = false
  for (const step of steps) {
    const status = step.trainingAssignmentId ? statusOf.get(step.trainingAssignmentId) : undefined
    if (step.trainingAssignmentId && status !== 'cancelled') continue
    await tx
      .update(onboardingStepProgress)
      .set({ trainingAssignmentId: input.trainingAssignmentId, updatedAt: now })
      .where(eq(onboardingStepProgress.id, step.id))
    changed = true
  }
  if (changed) await syncOnboardingForTraining(tx, actor, [input.trainingAssignmentId], now)
}

/** Update every onboarding step linked to these assignments. Safe to call after any change. */
export async function syncOnboardingForTraining(
  tx: Tx,
  actor: Actor,
  trainingAssignmentIds: readonly string[],
  now = new Date(),
): Promise<void> {
  const ids = [...new Set(trainingAssignmentIds)]
  if (ids.length === 0) return
  const organizationId = actor.organizationId

  const steps = await tx
    .select()
    .from(onboardingStepProgress)
    .where(
      and(
        eq(onboardingStepProgress.organizationId, organizationId),
        inArray(onboardingStepProgress.trainingAssignmentId, ids),
      ),
    )
  if (steps.length === 0) return

  const assignments = await tx
    .select()
    .from(trainingAssignments)
    .where(
      and(
        eq(trainingAssignments.organizationId, organizationId),
        inArray(trainingAssignments.id, ids),
      ),
    )
  const byId = new Map(assignments.map((a) => [a.id, a]))
  const titles = await versionTitles(
    tx,
    organizationId,
    assignments.map((a) => a.courseVersionId),
  )
  const exhausted = await outOfAttemptsFor(tx, organizationId, ids)
  const runs = new Map<string, string>()

  for (const step of steps) {
    // Completion is one-way.
    if (step.status === 'completed' || step.status === 'waived') continue
    const assignment = byId.get(step.trainingAssignmentId!)
    if (!assignment) continue
    const courseTitle = titles.get(assignment.courseVersionId) ?? 'the course'

    let status: 'pending' | 'blocked' | 'completed' = 'pending'
    let reason: string | null = null
    if (assignment.status === 'completed') {
      status = 'completed'
    } else if (assignment.status === 'cancelled') {
      status = 'blocked'
      const when = assignment.cancelledAt
        ? ` on ${formatDateInZone(assignment.cancelledAt, await timeZoneOf(tx, organizationId, assignment.employmentId))}`
        : ''
      reason = `“${courseTitle}” was withdrawn${when}. A manager can assign it again under Training.`
    } else if ((exhausted.get(assignment.id) ?? []).length > 0) {
      status = 'blocked'
      reason = `Out of attempts on “${exhausted.get(assignment.id)![0]!.lessonTitle}” in “${courseTitle}”. A manager can allow another attempt.`
    }
    if (status === step.status && reason === step.blockedReason) continue

    if (status === 'completed') {
      await tx
        .update(onboardingStepProgress)
        .set({
          status,
          blockedReason: null,
          completedAt: assignment.completedAt ?? now,
          completedByEmploymentId: assignment.employmentId,
          note: step.note ?? `Completed “${courseTitle}”, version ${assignment.versionNumber}.`,
          updatedAt: now,
        })
        .where(eq(onboardingStepProgress.id, step.id))
      await recordAuditEvent(tx, actor, {
        action: AUDIT_ACTIONS.ONBOARDING_STEP_COMPLETED,
        summary: `Completed onboarding step "${step.title}" when "${courseTitle}" was finished`,
        subjectType: 'employment',
        subjectId: assignment.employmentId,
        metadata: { stepProgressId: step.id, trainingAssignmentId: assignment.id },
      })
    } else {
      await tx
        .update(onboardingStepProgress)
        .set({ status, blockedReason: reason, updatedAt: now })
        .where(eq(onboardingStepProgress.id, step.id))
      if (status === 'blocked') {
        await recordAuditEvent(tx, actor, {
          action: AUDIT_ACTIONS.ONBOARDING_STEP_BLOCKED,
          summary: `Onboarding step "${step.title}" is blocked by its course`,
          subjectType: 'employment',
          subjectId: assignment.employmentId,
          metadata: { stepProgressId: step.id, trainingAssignmentId: assignment.id, reason },
        })
      }
    }
    runs.set(step.assignmentId, assignment.employmentId)
  }

  for (const [runId, employmentId] of runs) {
    const { justCompleted } = await refreshOnboardingCompletion(tx, organizationId, runId, now)
    if (justCompleted) {
      await recordAuditEvent(tx, actor, {
        action: AUDIT_ACTIONS.ONBOARDING_COMPLETED,
        summary: 'Onboarding complete',
        subjectType: 'employment',
        subjectId: employmentId,
      })
    }
  }
}

async function versionTitles(
  tx: Tx,
  organizationId: string,
  versionIds: readonly string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(versionIds)]
  if (ids.length === 0) return new Map()
  const rows = await tx
    .select({ id: courseVersions.id, title: courseVersions.title })
    .from(courseVersions)
    .where(and(eq(courseVersions.organizationId, organizationId), inArray(courseVersions.id, ids)))
  return new Map(rows.map((r) => [r.id, r.title]))
}

/** How each linked step's course stands, for the onboarding screens. Keyed by step progress id. */
export async function linkedTrainingViews(
  tx: Tx,
  organizationId: string,
  rows: readonly {
    id: string
    kind: string
    courseId: string | null
    trainingAssignmentId: string | null
  }[],
): Promise<Map<string, LinkedTraining>> {
  const out = new Map<string, LinkedTraining>()
  const linked = rows.filter((r) => r.kind === 'training_assignment' && r.courseId)
  if (linked.length === 0) return out

  const assignmentIds = [
    ...new Set(linked.map((r) => r.trainingAssignmentId).filter((id): id is string => !!id)),
  ]
  const assignments =
    assignmentIds.length === 0
      ? []
      : await tx
          .select()
          .from(trainingAssignments)
          .where(
            and(
              eq(trainingAssignments.organizationId, organizationId),
              inArray(trainingAssignments.id, assignmentIds),
            ),
          )
  const byId = new Map(assignments.map((a) => [a.id, a]))
  const progress = await progressFor(tx, organizationId, assignments)
  const exhausted = await outOfAttemptsFor(tx, organizationId, assignmentIds)
  const titles = await versionTitles(
    tx,
    organizationId,
    assignments.map((a) => a.courseVersionId),
  )
  const courseRows = await tx
    .select({ id: courses.id, title: courses.title, publishedTitle: courseVersions.title })
    .from(courses)
    .leftJoin(
      courseVersions,
      and(
        eq(courseVersions.organizationId, courses.organizationId),
        eq(courseVersions.id, courses.publishedVersionId),
      ),
    )
    .where(
      and(
        eq(courses.organizationId, organizationId),
        inArray(courses.id, [...new Set(linked.map((r) => r.courseId!))]),
      ),
    )
  const courseTitle = new Map(courseRows.map((c) => [c.id, c.publishedTitle ?? c.title]))

  for (const row of linked) {
    const assignment = row.trainingAssignmentId ? byId.get(row.trainingAssignmentId) : undefined
    const p = assignment ? progress.get(assignment.id) : undefined
    let state: LinkedTrainingState
    if (!assignment || !p) state = 'unavailable'
    else if (assignment.status === 'cancelled') state = 'withdrawn'
    else if (assignment.status === 'completed') state = 'completed'
    else if ((exhausted.get(assignment.id) ?? []).length > 0) state = 'blocked'
    else state = p.state === 'cancelled' ? 'withdrawn' : p.state

    out.set(row.id, {
      courseId: row.courseId!,
      courseTitle: assignment
        ? (titles.get(assignment.courseVersionId) ?? courseTitle.get(row.courseId!) ?? 'Training')
        : (courseTitle.get(row.courseId!) ?? 'Training'),
      assignmentId: assignment?.id ?? null,
      versionNumber: assignment?.versionNumber ?? null,
      state,
      completedLessons: p?.completed ?? 0,
      totalLessons: p?.total ?? 0,
      percent: p?.percent ?? 0,
      nextLessonId: p?.next?.id ?? null,
    })
  }
  return out
}
