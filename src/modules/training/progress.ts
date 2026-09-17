import { formatCalendarDate } from '@/lib/dates'
import type { LessonKind } from './content'

/*
 * PROGRESS, COMPUTED - NEVER STORED.
 *
 * A percentage in a column drifts the first time something writes one table
 * and not the other. Here it is derived from the lessons of the assigned
 * version and the person's progress rows, every time, by pure functions the
 * employee screen, the manager report and the service all share.
 *
 * Three questions the employee screens exist to answer, and where they are
 * answered:
 *
 *   what have I completed          courseProgress().completed, learnerOverview().completed
 *   what do I need to do next      courseProgress().next, learnerOverview().upNext
 *   how far am I from finishing    remaining lessons and minutes, percent
 *
 * Tone matters as much as arithmetic. Nothing here ranks one person against
 * another, and a missed due date is stated as a fact with a date, never as a
 * judgement.
 */

export type LessonState =
  'not_started' | 'in_progress' | 'awaiting_signoff' | 'returned' | 'completed'

export type AssignmentState =
  'not_started' | 'in_progress' | 'awaiting_signoff' | 'completed' | 'cancelled'

export interface ProgressLesson {
  id: string
  title: string
  kind: LessonKind
  position: number
  estimatedMinutes: number
}

export interface ProgressRecord {
  lessonId: string
  status: string
}

export interface LessonWithState extends ProgressLesson {
  /** 1-based, in course order. */
  number: number
  state: LessonState
}

export interface CourseProgress {
  lessons: LessonWithState[]
  total: number
  completed: number
  awaitingSignoff: number
  remaining: number
  /** Whole percent, rounded down: 100 only when every lesson is done. */
  percent: number
  remainingMinutes: number
  /** The lesson to do next: something sent back first, then course order. */
  next: LessonWithState | null
  state: AssignmentState
}

function lessonState(status: string | undefined): LessonState {
  switch (status) {
    case 'completed':
    case 'awaiting_signoff':
    case 'returned':
    case 'in_progress':
      return status
    default:
      return 'not_started'
  }
}

export function courseProgress(
  lessons: readonly ProgressLesson[],
  records: readonly ProgressRecord[],
  assignmentStatus: string,
): CourseProgress {
  const byLesson = new Map(records.map((r) => [r.lessonId, r.status]))
  const ordered = [...lessons]
    .sort((a, b) => a.position - b.position)
    .map((lesson, index) => ({
      ...lesson,
      number: index + 1,
      state: lessonState(byLesson.get(lesson.id)),
    }))

  const total = ordered.length
  const completed = ordered.filter((l) => l.state === 'completed').length
  const awaitingSignoff = ordered.filter((l) => l.state === 'awaiting_signoff').length
  const next =
    ordered.find((l) => l.state === 'returned') ??
    ordered.find((l) => l.state === 'in_progress' || l.state === 'not_started') ??
    null

  let state: AssignmentState
  if (assignmentStatus === 'cancelled') state = 'cancelled'
  else if (assignmentStatus === 'completed' || (total > 0 && completed === total)) {
    state = 'completed'
  } else if (next === null && awaitingSignoff > 0) state = 'awaiting_signoff'
  else if (records.length > 0 || assignmentStatus === 'in_progress') state = 'in_progress'
  else state = 'not_started'

  return {
    lessons: ordered,
    total,
    completed,
    awaitingSignoff,
    remaining: total - completed,
    percent: total === 0 ? 0 : completed === total ? 100 : Math.floor((completed * 100) / total),
    remainingMinutes: ordered
      .filter((l) => l.state !== 'completed')
      .reduce((sum, l) => sum + l.estimatedMinutes, 0),
    next,
    state,
  }
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** Whole calendar days from `from` to `to` (ISO dates). */
export function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10))
  return Math.round((b - a) / 86_400_000)
}

export type DueKind = 'none' | 'later' | 'soon' | 'today' | 'past' | 'met'

export interface DueStatus {
  kind: DueKind
  /** Days until due (negative once past), or null without a due date. */
  days: number | null
}

/** "Soon" is within three days: close enough to plan around this week. */
export function dueStatus(dueOn: string | null, today: string, finished: boolean): DueStatus {
  if (!dueOn) return { kind: 'none', days: null }
  const days = daysBetween(today, dueOn)
  if (finished) return { kind: 'met', days }
  if (days < 0) return { kind: 'past', days }
  if (days === 0) return { kind: 'today', days }
  if (days <= 3) return { kind: 'soon', days }
  return { kind: 'later', days }
}

// ---------------------------------------------------------------------------
// Moments of accomplishment
// ---------------------------------------------------------------------------

export type Milestone = 'course_complete' | 'halfway' | 'first_lesson' | 'lesson'

/** What a step forward means. Null when nothing was newly completed. */
export function milestoneBetween(
  before: { completed: number; total: number },
  after: { completed: number; total: number },
): Milestone | null {
  if (after.completed <= before.completed || after.total === 0) return null
  if (after.completed === after.total) return 'course_complete'
  if (before.completed === 0 && after.total > 2) return 'first_lesson'
  if (before.completed * 2 < after.total && after.completed * 2 >= after.total) return 'halfway'
  return 'lesson'
}

/**
 * The words for that moment. Plain, specific and adult: it says what was
 * achieved and what is left, and never compares the person with anyone.
 */
export function milestoneMessage(
  milestone: Milestone,
  context: { completed: number; total: number; courseTitle: string; nextTitle: string | null },
): string {
  const tally = `${context.completed} of ${context.total} lessons done`
  const next = context.nextTitle ? ` Next: ${context.nextTitle}.` : ''
  switch (milestone) {
    case 'course_complete':
      return `You finished ${context.courseTitle}. Every lesson is done.`
    case 'first_lesson':
      return `Good start: ${tally}.${next}`
    case 'halfway':
      return `Halfway there: ${tally}.${next}`
    case 'lesson':
      return `Lesson done: ${tally}.${next}`
  }
}

// ---------------------------------------------------------------------------
// Across everything a person has been assigned
// ---------------------------------------------------------------------------

export interface LearnerAssignment {
  id: string
  courseTitle: string
  dueOn: string | null
  assignedAt: Date
  completedAt: Date | null
  progress: CourseProgress
}

export interface LearnerOverview {
  /** Still to finish, most pressing first. */
  active: LearnerAssignment[]
  /** Finished, most recent first. */
  completed: LearnerAssignment[]
  /** The one thing to do next, or null when nothing is actionable right now. */
  upNext: LearnerAssignment | null
  lessonsRemaining: number
  minutesRemaining: number
  pastDue: number
  waitingOnSignoff: number
}

/**
 * Most pressing first: past due, then soonest due date, then something already
 * started, then the order it was assigned. An assignment whose only remaining
 * work is a manager's sign-off goes last - there is nothing for the person to
 * do on it right now.
 */
export function learnerOverview(
  items: readonly LearnerAssignment[],
  today: string,
): LearnerOverview {
  const active = items.filter(
    (i) => i.progress.state !== 'completed' && i.progress.state !== 'cancelled',
  )
  const completed = items
    .filter((i) => i.progress.state === 'completed')
    .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0))

  const rank = (i: LearnerAssignment) => {
    const waiting = i.progress.next === null ? 1 : 0
    const days = i.dueOn ? daysBetween(today, i.dueOn) : Number.POSITIVE_INFINITY
    const started = i.progress.state === 'in_progress' ? 0 : 1
    return [waiting, days < 0 ? 0 : 1, days, started, i.assignedAt.getTime()] as const
  }
  active.sort((a, b) => {
    const ra = rank(a)
    const rb = rank(b)
    for (let k = 0; k < ra.length; k += 1) {
      if (ra[k] !== rb[k]) return ra[k]! < rb[k]! ? -1 : 1
    }
    return 0
  })

  return {
    active,
    completed,
    upNext: active.find((i) => i.progress.next !== null) ?? null,
    lessonsRemaining: active.reduce((sum, i) => sum + i.progress.remaining, 0),
    minutesRemaining: active.reduce((sum, i) => sum + i.progress.remainingMinutes, 0),
    pastDue: active.filter((i) => i.dueOn !== null && daysBetween(today, i.dueOn) < 0).length,
    waitingOnSignoff: active.filter((i) => i.progress.awaitingSignoff > 0).length,
  }
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export type StatusTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info'

/**
 * The manager's status for one assignment. Overdue is stated here, to the
 * people responsible for following up - the employee sees the date instead.
 */
export function managerStatus(
  state: AssignmentState,
  due: DueStatus,
): { key: string; label: string; tone: StatusTone } {
  if (state === 'completed') return { key: 'completed', label: 'Completed', tone: 'success' }
  if (state === 'cancelled') return { key: 'cancelled', label: 'Withdrawn', tone: 'neutral' }
  if (due.kind === 'past') return { key: 'overdue', label: 'Overdue', tone: 'danger' }
  if (state === 'awaiting_signoff') {
    return { key: 'awaiting_signoff', label: 'Waiting for sign-off', tone: 'accent' }
  }
  if (state === 'in_progress') return { key: 'in_progress', label: 'In progress', tone: 'info' }
  return { key: 'not_started', label: 'Not started', tone: 'neutral' }
}

export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`
}

/** "Due today", "Due in 2 days", "Due Sep 19, 2026" - the employee's wording. */
export function dueLabel(dueOn: string | null, due: DueStatus): string | null {
  if (!dueOn || due.kind === 'none') return null
  const date = formatCalendarDate(dueOn)
  switch (due.kind) {
    case 'today':
      return 'Due today'
    case 'soon':
      return due.days === 1 ? 'Due tomorrow' : `Due in ${due.days} days`
    case 'past':
      return `Was due ${date}`
    case 'met':
      return `Due ${date}`
    default:
      return `Due ${date}`
  }
}
