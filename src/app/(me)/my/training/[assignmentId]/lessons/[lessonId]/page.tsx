import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { formatDateInZone } from '@/lib/dates'
import { NotFoundError } from '@/lib/errors'
import { isUuid } from '@/lib/uuid'
import { LESSON_KIND_LABELS } from '@/modules/training/content'
import { myLesson } from '@/modules/training/learner'
import { AnnouncementBody } from '@/ui/patterns/announcement-body'
import { ProgressBar } from '@/ui/primitives'
import { EmployeeShell } from '../../../../_components/employee-shell'
import { LessonPlayer } from './lesson-player'

export const metadata: Metadata = { title: 'Lesson' }
export const dynamic = 'force-dynamic'

export default async function MyLessonPage({
  params,
}: {
  params: Promise<{ assignmentId: string; lessonId: string }>
}) {
  const { assignmentId, lessonId } = await params
  if (!isUuid(assignmentId) || !isUuid(lessonId)) notFound()
  const { actor } = await requireActorContext()
  const data = await withTenant(actor.organizationId, async (tx) => {
    try {
      return await myLesson(tx, actor, assignmentId, lessonId)
    } catch (error) {
      if (error instanceof NotFoundError) return null
      throw error
    }
  })
  if (!data) notFound()

  const { assignment, lesson, quiz, practical } = data
  const tz = assignment.timeZone
  const courseHref = `/my/training/${assignmentId}`
  const latest = practical?.history[0] ?? null
  const verified = practical?.history.find((h) => h.decision === 'verified') ?? null
  const lastAttempt = quiz?.attempts.at(-1) ?? null

  return (
    <EmployeeShell back={{ href: courseHref, label: 'Course' }}>
      <p className="text-faint text-xs font-semibold tracking-[0.1em] uppercase">
        {assignment.courseTitle}
      </p>
      <h1 className="font-display text-ink mt-1 text-2xl font-extrabold tracking-tight text-balance">
        {lesson.title}
      </h1>
      <p className="text-muted mt-1 text-sm">
        Lesson {lesson.number} of {lesson.total} · {LESSON_KIND_LABELS[lesson.kind]} · about{' '}
        {lesson.estimatedMinutes} min
      </p>
      <ProgressBar
        className="mt-4"
        value={assignment.progress.percent}
        label={`${assignment.progress.completed} of ${assignment.progress.total} lessons done`}
        tone={assignment.progress.state === 'completed' ? 'success' : 'violet'}
      />
      {assignment.status === 'completed' ? (
        <p className="text-muted mt-3 text-sm">
          You have completed this course. You can look back over any lesson.
        </p>
      ) : null}

      {lesson.body ? (
        <div className="mt-6">
          <AnnouncementBody body={lesson.body} />
        </div>
      ) : null}

      <LessonPlayer
        assignmentId={assignmentId}
        lessonId={lessonId}
        kind={lesson.kind}
        state={lesson.state}
        readOnly={data.readOnly}
        checklist={data.checklist}
        quiz={
          quiz
            ? {
                questions: quiz.questions,
                neededToPass: quiz.neededToPass,
                attemptsAllowed: quiz.attemptsAllowed,
                attemptsUsed: quiz.attemptsUsed,
                passed: quiz.passed,
                lastAttempt: lastAttempt
                  ? {
                      correctCount: lastAttempt.correctCount,
                      questionCount: lastAttempt.questionCount,
                    }
                  : null,
                review: quiz.review,
              }
            : null
        }
        practical={
          practical
            ? {
                criteria: practical.criteria,
                requestedLabel: practical.requestedAt
                  ? formatDateInZone(practical.requestedAt, tz)
                  : null,
                returned:
                  lesson.state === 'returned' && latest?.decision === 'returned'
                    ? {
                        byName: latest.byName,
                        dateLabel: formatDateInZone(latest.at, tz),
                        note: latest.note,
                      }
                    : null,
                verified: verified
                  ? { byName: verified.byName, dateLabel: formatDateInZone(verified.at, tz) }
                  : null,
              }
            : null
        }
      />

      <nav
        aria-label="Lessons"
        className="border-line mt-8 flex items-center justify-between gap-3 border-t pt-4 text-sm"
      >
        {data.previousLessonId ? (
          <Link
            href={`${courseHref}/lessons/${data.previousLessonId}`}
            className="inline-flex min-h-11 items-center font-medium text-violet-700 underline underline-offset-4"
          >
            ← Previous lesson
          </Link>
        ) : (
          <span />
        )}
        <Link
          href={data.nextLessonId ? `${courseHref}/lessons/${data.nextLessonId}` : courseHref}
          className="inline-flex min-h-11 items-center font-medium text-violet-700 underline underline-offset-4"
        >
          {data.nextLessonId ? 'Next lesson →' : 'Back to the course'}
        </Link>
      </nav>
    </EmployeeShell>
  )
}
