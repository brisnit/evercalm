import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import type { Tx } from '@/server/db'
import { employments } from '@/server/db/schema'
import type { Actor } from '@/server/authz'
import { AUDIT_ACTIONS, recordAuditEvent } from '@/server/audit'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { newId } from '@/lib/ids'
import { normalizeBody } from '@/modules/comms/content'
import {
  attemptsAllowed,
  learnerQuestions,
  neededToPass,
  parseLessonContent,
  scoreQuiz,
  type ContentItem,
  type LearnerQuestion,
  type LessonKind,
} from './content'
import {
  dueStatus,
  learnerOverview,
  milestoneBetween,
  milestoneMessage,
  type CourseProgress,
  type DueStatus,
  type LearnerOverview,
} from './progress'
import { businessDate } from '@/lib/dates'
import { syncOnboardingForTraining } from '@/modules/onboarding/training-link'
import { progressFor, settleAssignment, timeZoneOf, type AssignmentRow } from './records'
import {
  courseLessons,
  courseVersions,
  trainingAssignments,
  trainingLessonProgress,
  trainingQuizAttempts,
  trainingSignoffs,
} from './schema'

/*
 * THE EMPLOYEE'S TRAINING.
 *
 * Self-access only, and no capability is involved: every read and write here
 * starts by loading the assignment and checking it belongs to the actor. A
 * manager viewing someone's progress uses the reports in ./assignments.ts,
 * never these functions - so there is no path by which one employee's answers
 * or notes reach another.
 *
 * Everything is read from the version the assignment is pinned to. A lesson
 * id from any other version is simply not found.
 *
 * Page reads never write. An assignment becomes "in progress" when the person
 * first DOES something - ticks an item, answers a quiz, marks a reading done -
 * not when a page happened to be rendered or prefetched.
 */

export interface MyAssignment {
  id: string
  courseId: string
  courseTitle: string
  summary: string
  versionNumber: number
  required: boolean
  note: string
  dueOn: string | null
  due: DueStatus
  assignedAt: Date
  assignedByName: string | null
  completedAt: Date | null
  status: string
  progress: CourseProgress
}

export interface MyTraining {
  today: string
  timeZone: string
  overview: Omit<LearnerOverview, 'active' | 'completed' | 'upNext'> & {
    active: MyAssignment[]
    completed: MyAssignment[]
    upNext: MyAssignment | null
  }
}

async function cards(
  tx: Tx,
  actor: Actor,
  rows: AssignmentRow[],
  today: string,
): Promise<MyAssignment[]> {
  if (rows.length === 0) return []
  const progress = await progressFor(tx, actor.organizationId, rows)
  const versions = await tx
    .select({ id: courseVersions.id, title: courseVersions.title, summary: courseVersions.summary })
    .from(courseVersions)
    .where(
      and(
        eq(courseVersions.organizationId, actor.organizationId),
        inArray(courseVersions.id, [...new Set(rows.map((r) => r.courseVersionId))]),
      ),
    )
  const versionById = new Map(versions.map((v) => [v.id, v]))
  const assigners = [
    ...new Set(rows.map((r) => r.assignedByEmploymentId).filter(Boolean)),
  ] as string[]
  const assignerRows =
    assigners.length > 0
      ? await tx
          .select({ id: employments.id, name: employments.displayName })
          .from(employments)
          .where(
            and(
              eq(employments.organizationId, actor.organizationId),
              inArray(employments.id, assigners),
            ),
          )
      : []
  const nameById = new Map(assignerRows.map((r) => [r.id, r.name]))

  return rows.map((row) => {
    const p = progress.get(row.id)!
    const version = versionById.get(row.courseVersionId)
    return {
      id: row.id,
      courseId: row.courseId,
      courseTitle: version?.title ?? 'Training',
      summary: version?.summary ?? '',
      versionNumber: row.versionNumber,
      required: row.required,
      note: row.note,
      dueOn: row.dueOn,
      due: dueStatus(row.dueOn, today, p.state === 'completed'),
      assignedAt: row.assignedAt,
      assignedByName: row.assignedByEmploymentId
        ? (nameById.get(row.assignedByEmploymentId) ?? null)
        : null,
      completedAt: row.completedAt,
      status: row.status,
      progress: p,
    }
  })
}

export async function myTraining(tx: Tx, actor: Actor, now = new Date()): Promise<MyTraining> {
  const timeZone = await timeZoneOf(tx, actor.organizationId, actor.employmentId)
  const today = businessDate(now, timeZone)
  const rows = await tx
    .select()
    .from(trainingAssignments)
    .where(
      and(
        eq(trainingAssignments.organizationId, actor.organizationId),
        eq(trainingAssignments.employmentId, actor.employmentId),
        ne(trainingAssignments.status, 'cancelled'),
      ),
    )
    .orderBy(asc(trainingAssignments.assignedAt))
  const mine = await cards(tx, actor, rows, today)
  const overview = learnerOverview(
    mine.map((m) => ({ ...m, courseTitle: m.courseTitle })),
    today,
  )
  const byId = new Map(mine.map((m) => [m.id, m]))
  return {
    today,
    timeZone,
    overview: {
      ...overview,
      active: overview.active.map((a) => byId.get(a.id)!),
      completed: overview.completed.map((a) => byId.get(a.id)!),
      upNext: overview.upNext ? byId.get(overview.upNext.id)! : null,
    },
  }
}

async function ownAssignment(
  tx: Tx,
  actor: Actor,
  assignmentId: string,
  options: { lock?: boolean } = {},
): Promise<AssignmentRow> {
  const query = tx
    .select()
    .from(trainingAssignments)
    .where(
      and(
        eq(trainingAssignments.organizationId, actor.organizationId),
        eq(trainingAssignments.id, assignmentId),
      ),
    )
  const [row] = options.lock ? await query.for('update').limit(1) : await query.limit(1)
  // Somebody else's assignment is exactly as invisible as one that does not exist.
  if (!row || row.employmentId !== actor.employmentId) {
    throw new NotFoundError('Training not found')
  }
  return row
}

export interface CompletionSummary {
  completedAt: Date
  lessons: number
  quizzes: { lessonTitle: string; scorePercent: number; attempts: number }[]
  signedOff: { lessonTitle: string; byName: string; at: Date }[]
}

export async function myAssignment(
  tx: Tx,
  actor: Actor,
  assignmentId: string,
  now = new Date(),
): Promise<MyAssignment & { completion: CompletionSummary | null; timeZone: string }> {
  const row = await ownAssignment(tx, actor, assignmentId)
  const timeZone = await timeZoneOf(tx, actor.organizationId, actor.employmentId)
  const today = businessDate(now, timeZone)
  const [card] = await cards(tx, actor, [row], today)

  let completion: CompletionSummary | null = null
  if (row.status === 'completed' && row.completedAt) {
    const titles = new Map(card!.progress.lessons.map((l) => [l.id, l.title]))
    const attempts = await tx
      .select({
        lessonId: trainingQuizAttempts.lessonId,
        best: sql<number>`max(${trainingQuizAttempts.scorePercent})::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(trainingQuizAttempts)
      .where(
        and(
          eq(trainingQuizAttempts.organizationId, actor.organizationId),
          eq(trainingQuizAttempts.assignmentId, row.id),
          eq(trainingQuizAttempts.passed, true),
        ),
      )
      .groupBy(trainingQuizAttempts.lessonId)
    const allAttempts = await tx
      .select({ lessonId: trainingQuizAttempts.lessonId, count: sql<number>`count(*)::int` })
      .from(trainingQuizAttempts)
      .where(
        and(
          eq(trainingQuizAttempts.organizationId, actor.organizationId),
          eq(trainingQuizAttempts.assignmentId, row.id),
        ),
      )
      .groupBy(trainingQuizAttempts.lessonId)
    const signoffs = await tx
      .select({
        lessonId: trainingSignoffs.lessonId,
        byName: employments.displayName,
        at: trainingSignoffs.decidedAt,
      })
      .from(trainingSignoffs)
      .innerJoin(
        employments,
        and(
          eq(employments.organizationId, trainingSignoffs.organizationId),
          eq(employments.id, trainingSignoffs.decidedByEmploymentId),
        ),
      )
      .where(
        and(
          eq(trainingSignoffs.organizationId, actor.organizationId),
          eq(trainingSignoffs.assignmentId, row.id),
          eq(trainingSignoffs.decision, 'verified'),
        ),
      )
    completion = {
      completedAt: row.completedAt,
      lessons: card!.progress.total,
      quizzes: attempts.map((a) => ({
        lessonTitle: titles.get(a.lessonId) ?? 'Knowledge check',
        scorePercent: a.best,
        attempts: allAttempts.find((x) => x.lessonId === a.lessonId)?.count ?? 1,
      })),
      signedOff: signoffs.map((s) => ({
        lessonTitle: titles.get(s.lessonId) ?? 'Practical',
        byName: s.byName,
        at: s.at,
      })),
    }
  }
  return { ...card!, completion, timeZone }
}

// ---------------------------------------------------------------------------
// One lesson
// ---------------------------------------------------------------------------

export interface QuizAttemptView {
  number: number
  correctCount: number
  questionCount: number
  scorePercent: number
  passed: boolean
  submittedAt: Date
}

export interface QuizReviewItem {
  questionId: string
  prompt: string
  kind: string
  options: ContentItem[]
  chosenOptionIds: string[]
  correct: boolean
  /** Only once the person has passed. */
  correctOptionIds: string[] | null
  explanation: string | null
}

export interface MyLesson {
  assignment: MyAssignment & { timeZone: string }
  readOnly: boolean
  lesson: {
    id: string
    number: number
    total: number
    title: string
    kind: LessonKind
    body: string
    estimatedMinutes: number
    state: string
  }
  previousLessonId: string | null
  nextLessonId: string | null
  checklist: { items: ContentItem[]; checked: string[] } | null
  quiz: {
    questions: LearnerQuestion[]
    passPercent: number
    neededToPass: number
    attemptsAllowed: number | null
    attemptsUsed: number
    passed: boolean
    attempts: QuizAttemptView[]
    review: QuizReviewItem[] | null
  } | null
  practical: {
    criteria: ContentItem[]
    requestedAt: Date | null
    history: { decision: string; note: string; byName: string; at: Date }[]
  } | null
}

export async function myLesson(
  tx: Tx,
  actor: Actor,
  assignmentId: string,
  lessonId: string,
  now = new Date(),
): Promise<MyLesson> {
  const assignment = await myAssignment(tx, actor, assignmentId, now)
  const ordered = assignment.progress.lessons
  const index = ordered.findIndex((l) => l.id === lessonId)
  if (index === -1) throw new NotFoundError('Lesson not found')

  const [row] = await tx
    .select()
    .from(courseLessons)
    .where(
      and(eq(courseLessons.organizationId, actor.organizationId), eq(courseLessons.id, lessonId)),
    )
    .limit(1)
  if (!row) throw new NotFoundError('Lesson not found')
  const content = parseLessonContent(row.kind, row.content)

  const [progress] = await tx
    .select()
    .from(trainingLessonProgress)
    .where(
      and(
        eq(trainingLessonProgress.organizationId, actor.organizationId),
        eq(trainingLessonProgress.assignmentId, assignmentId),
        eq(trainingLessonProgress.lessonId, lessonId),
      ),
    )
    .limit(1)

  const view: MyLesson = {
    assignment,
    readOnly: assignment.status === 'completed' || assignment.status === 'cancelled',
    lesson: {
      id: row.id,
      number: index + 1,
      total: ordered.length,
      title: row.title,
      kind: ordered[index]!.kind,
      body: row.body,
      estimatedMinutes: row.estimatedMinutes,
      state: ordered[index]!.state,
    },
    previousLessonId: ordered[index - 1]?.id ?? null,
    nextLessonId: ordered[index + 1]?.id ?? null,
    checklist: null,
    quiz: null,
    practical: null,
  }

  if (content.kind === 'checklist') {
    view.checklist = { items: content.items, checked: progress?.checkedItemIds ?? [] }
  }

  if (content.kind === 'quiz') {
    const attempts = await tx
      .select()
      .from(trainingQuizAttempts)
      .where(
        and(
          eq(trainingQuizAttempts.organizationId, actor.organizationId),
          eq(trainingQuizAttempts.assignmentId, assignmentId),
          eq(trainingQuizAttempts.lessonId, lessonId),
        ),
      )
      .orderBy(asc(trainingQuizAttempts.attemptNumber))
    const passed = attempts.some((a) => a.passed)
    const latest = attempts.at(-1)
    view.quiz = {
      questions: learnerQuestions(content),
      passPercent: content.passPercent,
      neededToPass: neededToPass(content.passPercent, content.questions.length),
      attemptsAllowed: attemptsAllowed(content.maxAttempts, progress?.extraAttempts ?? 0),
      attemptsUsed: attempts.length,
      passed,
      attempts: attempts.map((a) => ({
        number: a.attemptNumber,
        correctCount: a.correctCount,
        questionCount: a.questionCount,
        scorePercent: a.scorePercent,
        passed: a.passed,
        submittedAt: a.submittedAt,
      })),
      review: latest
        ? content.questions.map((q) => {
            const chosen = latest.answers[q.id] ?? []
            const result = scoreQuiz({ questions: [q], passPercent: 100 }, { [q.id]: chosen })
            return {
              questionId: q.id,
              prompt: q.prompt,
              kind: q.kind,
              options: q.options,
              chosenOptionIds: chosen,
              correct: result.passed,
              // The answer key is shown only after a pass, so it cannot be
              // read off a failed attempt and typed back in.
              correctOptionIds: passed ? q.correctOptionIds : null,
              explanation: passed ? q.explanation || null : null,
            }
          })
        : null,
    }
  }

  if (content.kind === 'practical') {
    const history = progress
      ? await tx
          .select({
            decision: trainingSignoffs.decision,
            note: trainingSignoffs.note,
            byName: employments.displayName,
            at: trainingSignoffs.decidedAt,
          })
          .from(trainingSignoffs)
          .innerJoin(
            employments,
            and(
              eq(employments.organizationId, trainingSignoffs.organizationId),
              eq(employments.id, trainingSignoffs.decidedByEmploymentId),
            ),
          )
          .where(
            and(
              eq(trainingSignoffs.organizationId, actor.organizationId),
              eq(trainingSignoffs.progressId, progress.id),
            ),
          )
          .orderBy(desc(trainingSignoffs.decidedAt))
      : []
    view.practical = {
      criteria: content.criteria,
      requestedAt: progress?.status === 'awaiting_signoff' ? progress.signoffRequestedAt : null,
      history,
    }
  }

  return view
}

// ---------------------------------------------------------------------------
// Doing a lesson
// ---------------------------------------------------------------------------

export interface StepResult {
  message: string
  nextLessonId: string | null
  courseComplete: boolean
  passed?: boolean
}

interface LessonContext {
  assignment: AssignmentRow
  lesson: typeof courseLessons.$inferSelect
  courseTitle: string
  progress: typeof trainingLessonProgress.$inferSelect | null
  before: CourseProgress
}

/**
 * Load and lock everything one learner action needs. The assignment row is
 * locked, so two taps on "Submit" become two attempts in order - never two
 * attempts with the same number, and never a pass counted twice.
 */
async function lessonContext(
  tx: Tx,
  actor: Actor,
  assignmentId: string,
  lessonId: string,
): Promise<LessonContext> {
  const assignment = await ownAssignment(tx, actor, assignmentId, { lock: true })
  if (assignment.status === 'cancelled') {
    throw new ValidationError({}, 'This training was withdrawn, so there is nothing to do here.')
  }
  const [lesson] = await tx
    .select()
    .from(courseLessons)
    .where(
      and(
        eq(courseLessons.organizationId, actor.organizationId),
        eq(courseLessons.id, lessonId),
        // Only lessons from the version this person was given.
        eq(courseLessons.versionId, assignment.courseVersionId),
      ),
    )
    .limit(1)
  if (!lesson) throw new NotFoundError('Lesson not found')

  const [version] = await tx
    .select({ title: courseVersions.title })
    .from(courseVersions)
    .where(eq(courseVersions.id, assignment.courseVersionId))
    .limit(1)
  const [progress] = await tx
    .select()
    .from(trainingLessonProgress)
    .where(
      and(
        eq(trainingLessonProgress.organizationId, actor.organizationId),
        eq(trainingLessonProgress.assignmentId, assignmentId),
        eq(trainingLessonProgress.lessonId, lessonId),
      ),
    )
    .for('update')
    .limit(1)
  const before = (await progressFor(tx, actor.organizationId, [assignment])).get(assignment.id)!
  return {
    assignment,
    lesson,
    courseTitle: version?.title ?? 'Training',
    progress: progress ?? null,
    before,
  }
}

async function writeProgress(
  tx: Tx,
  context: LessonContext,
  values: Partial<typeof trainingLessonProgress.$inferInsert> & { status: string },
  now: Date,
): Promise<void> {
  if (context.progress) {
    await tx
      .update(trainingLessonProgress)
      .set({ ...values, updatedAt: now })
      .where(eq(trainingLessonProgress.id, context.progress.id))
    return
  }
  await tx.insert(trainingLessonProgress).values({
    id: newId(),
    organizationId: context.assignment.organizationId,
    assignmentId: context.assignment.id,
    versionId: context.assignment.courseVersionId,
    lessonId: context.lesson.id,
    employmentId: context.assignment.employmentId,
    ...values,
  })
}

async function finish(
  tx: Tx,
  actor: Actor,
  context: LessonContext,
  now: Date,
  lead: string | null,
): Promise<StepResult> {
  const { progress: after, justCompleted } = await settleAssignment(
    tx,
    actor,
    context.assignment,
    context.courseTitle,
    now,
  )
  await syncOnboardingForTraining(tx, actor, [context.assignment.id], now)
  const milestone = milestoneBetween(context.before, after)
  const next = after.next && after.next.id !== context.lesson.id ? after.next : null
  const words = milestone
    ? milestoneMessage(milestone, {
        completed: after.completed,
        total: after.total,
        courseTitle: context.courseTitle,
        nextTitle: next?.title ?? null,
      })
    : null
  return {
    message: [lead, words].filter(Boolean).join(' ') || 'Saved.',
    nextLessonId: next?.id ?? null,
    courseComplete: justCompleted,
  }
}

function refuseIfCompleted(context: LessonContext, message: string): void {
  if (context.progress?.status === 'completed') throw new ValidationError({}, message)
}

export async function completeReading(
  tx: Tx,
  actor: Actor,
  assignmentId: string,
  lessonId: string,
  now = new Date(),
): Promise<StepResult> {
  const context = await lessonContext(tx, actor, assignmentId, lessonId)
  if (context.lesson.kind !== 'reading') throw new NotFoundError('Lesson not found')
  refuseIfCompleted(context, 'You have already finished this lesson.')
  await writeProgress(tx, context, { status: 'completed', completedAt: now }, now)
  return finish(tx, actor, context, now, null)
}

export async function saveChecklist(
  tx: Tx,
  actor: Actor,
  assignmentId: string,
  lessonId: string,
  checkedIds: readonly string[],
  now = new Date(),
): Promise<StepResult> {
  const context = await lessonContext(tx, actor, assignmentId, lessonId)
  const content = parseLessonContent(context.lesson.kind, context.lesson.content)
  if (content.kind !== 'checklist') throw new NotFoundError('Lesson not found')
  refuseIfCompleted(context, 'You have already finished this checklist.')

  const valid = new Set(content.items.map((i) => i.id))
  const checked = [...new Set(checkedIds.filter((id) => valid.has(id)))]
  const done = checked.length === content.items.length && content.items.length > 0
  await writeProgress(
    tx,
    context,
    {
      status: done ? 'completed' : 'in_progress',
      checkedItemIds: checked,
      completedAt: done ? now : null,
    },
    now,
  )
  if (!done) {
    await settleAssignment(tx, actor, context.assignment, context.courseTitle, now)
    await syncOnboardingForTraining(tx, actor, [context.assignment.id], now)
    return {
      message: `Saved: ${checked.length} of ${content.items.length} checked. Come back and finish the rest when you can.`,
      nextLessonId: null,
      courseComplete: false,
    }
  }
  return finish(tx, actor, context, now, null)
}

export async function submitQuiz(
  tx: Tx,
  actor: Actor,
  assignmentId: string,
  lessonId: string,
  answers: Readonly<Record<string, readonly string[]>>,
  now = new Date(),
): Promise<StepResult> {
  const context = await lessonContext(tx, actor, assignmentId, lessonId)
  const content = parseLessonContent(context.lesson.kind, context.lesson.content)
  if (content.kind !== 'quiz') throw new NotFoundError('Lesson not found')
  refuseIfCompleted(context, 'You have already passed this knowledge check.')

  const unanswered = content.questions.filter((q) => (answers[q.id] ?? []).length === 0)
  if (unanswered.length > 0) {
    throw new ValidationError(
      { answers: ['Answer every question before you submit.'] },
      unanswered.length === 1
        ? 'One question still needs an answer.'
        : `${unanswered.length} questions still need an answer.`,
    )
  }

  const [{ used } = { used: 0 }] = await tx
    .select({ used: sql<number>`count(*)::int` })
    .from(trainingQuizAttempts)
    .where(
      and(
        eq(trainingQuizAttempts.organizationId, actor.organizationId),
        eq(trainingQuizAttempts.assignmentId, assignmentId),
        eq(trainingQuizAttempts.lessonId, lessonId),
      ),
    )
  const allowed = attemptsAllowed(content.maxAttempts, context.progress?.extraAttempts ?? 0)
  if (allowed !== null && used >= allowed) {
    throw new ValidationError(
      {},
      'You have used every attempt for this knowledge check. Your manager can give you another one.',
    )
  }

  // Keep only real questions and options: nothing posted is trusted.
  const stored: Record<string, string[]> = {}
  for (const q of content.questions) {
    const valid = new Set(q.options.map((o) => o.id))
    stored[q.id] = [...new Set((answers[q.id] ?? []).filter((id) => valid.has(id)))]
  }
  const score = scoreQuiz(content, stored)
  const attemptNumber = used + 1

  await tx.insert(trainingQuizAttempts).values({
    id: newId(),
    organizationId: actor.organizationId,
    assignmentId,
    versionId: context.assignment.courseVersionId,
    lessonId,
    employmentId: actor.employmentId,
    attemptNumber,
    answers: stored,
    correctCount: score.correctCount,
    questionCount: score.questionCount,
    scorePercent: score.scorePercent,
    passed: score.passed,
    submittedAt: now,
  })
  await writeProgress(
    tx,
    context,
    { status: score.passed ? 'completed' : 'in_progress', completedAt: score.passed ? now : null },
    now,
  )
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.TRAINING_QUIZ_ATTEMPTED,
    summary: `${score.passed ? 'Passed' : 'Did not yet pass'} "${context.lesson.title}" (attempt ${attemptNumber}, ${score.correctCount} of ${score.questionCount})`,
    subjectType: 'training_assignment',
    subjectId: assignmentId,
    metadata: {
      lessonId,
      attemptNumber,
      scorePercent: score.scorePercent,
      passed: score.passed,
    },
  })

  if (!score.passed) {
    await settleAssignment(tx, actor, context.assignment, context.courseTitle, now)
    // Out of attempts blocks a linked onboarding step until a manager helps.
    await syncOnboardingForTraining(tx, actor, [context.assignment.id], now)
    const left = allowed === null ? null : allowed - attemptNumber
    const attemptsText =
      left === null
        ? ''
        : left === 0
          ? ' That was your last attempt; your manager can give you another.'
          : ` ${left} ${left === 1 ? 'attempt' : 'attempts'} left.`
    return {
      message: `Not yet: ${score.correctCount} of ${score.questionCount} correct, and a pass needs ${score.neededToPass}. The questions you missed are marked below. Look back over the lessons, then try again.${attemptsText}`,
      nextLessonId: null,
      courseComplete: false,
      passed: false,
    }
  }

  const result = await finish(
    tx,
    actor,
    context,
    now,
    `Passed: ${score.correctCount} of ${score.questionCount} correct.`,
  )
  return { ...result, passed: true }
}

export async function requestSignoff(
  tx: Tx,
  actor: Actor,
  assignmentId: string,
  lessonId: string,
  now = new Date(),
): Promise<StepResult> {
  const context = await lessonContext(tx, actor, assignmentId, lessonId)
  if (context.lesson.kind !== 'practical') throw new NotFoundError('Lesson not found')
  refuseIfCompleted(context, 'This practical has already been signed off.')
  if (context.progress?.status === 'awaiting_signoff') {
    return {
      message: 'You have already asked for this sign-off. A manager will confirm it with you.',
      nextLessonId: null,
      courseComplete: false,
    }
  }
  if (context.assignment.status === 'completed') {
    throw new ValidationError({}, 'You have already completed this course.')
  }

  await writeProgress(
    tx,
    context,
    { status: 'awaiting_signoff', signoffRequestedAt: now, completedAt: null },
    now,
  )
  await settleAssignment(tx, actor, context.assignment, context.courseTitle, now)
  await syncOnboardingForTraining(tx, actor, [context.assignment.id], now)
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.TRAINING_SIGNOFF_REQUESTED,
    summary: `Asked for sign-off on "${context.lesson.title}"`,
    subjectType: 'training_assignment',
    subjectId: assignmentId,
    locationId: context.assignment.locationId,
    metadata: { lessonId },
  })
  const after = (await progressFor(tx, actor.organizationId, [context.assignment])).get(
    context.assignment.id,
  )!
  const next = after.next && after.next.id !== lessonId ? after.next : null
  return {
    message: `Sign-off requested. A manager will watch you do this and confirm it.${
      next ? ` Meanwhile, next up: ${next.title}.` : ''
    }`,
    nextLessonId: next?.id ?? null,
    courseComplete: false,
  }
}

/** Plain-text note clean-up shared with the sign-off decision. */
export function cleanNote(raw: string): string {
  return normalizeBody(raw).slice(0, 500)
}
