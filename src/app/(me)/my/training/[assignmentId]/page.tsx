import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { cn } from '@/lib/cn'
import { formatDateInZone } from '@/lib/dates'
import { NotFoundError } from '@/lib/errors'
import { isUuid } from '@/lib/uuid'
import { LESSON_KIND_LABELS } from '@/modules/training/content'
import { myAssignment } from '@/modules/training/learner'
import { dueLabel, formatMinutes } from '@/modules/training/progress'
import { Badge, ButtonLink, Card, ProgressBar } from '@/ui/primitives'
import { EmployeeShell } from '../../_components/employee-shell'
import { TrainingTrail } from '../_components/training-trail'
import { CheckMark } from '../_components/check-mark'
import { LESSON_STATE } from '../_components/lesson-state'

export const metadata: Metadata = { title: 'Course' }
export const dynamic = 'force-dynamic'

export default async function MyCoursePage({
  params,
}: {
  params: Promise<{ assignmentId: string }>
}) {
  const { assignmentId } = await params
  if (!isUuid(assignmentId)) notFound()
  const { actor } = await requireActorContext()
  const data = await withTenant(actor.organizationId, async (tx) => {
    try {
      return await myAssignment(tx, actor, assignmentId)
    } catch (error) {
      if (error instanceof NotFoundError) return null
      throw error
    }
  })
  if (!data) notFound()
  const { progress } = data
  const next = progress.next
  const due = dueLabel(data.dueOn, data.due)

  return (
    <EmployeeShell back={{ href: '/my', label: 'Home' }}>
      <TrainingTrail
        up={{ href: '/my/training', label: 'All training' }}
        across={{ href: '/my', label: 'Home' }}
      />
      <h1 className="font-display text-ink text-2xl font-extrabold tracking-tight text-balance">
        {data.courseTitle}
      </h1>
      {data.summary ? <p className="text-muted mt-1.5 text-sm">{data.summary}</p> : null}

      {data.status === 'cancelled' ? (
        <Card className="mt-5 p-5">
          <p className="text-ink font-medium">This training was withdrawn.</p>
          <p className="text-muted mt-1 text-sm">You do not need to finish it.</p>
        </Card>
      ) : data.completion ? (
        <section
          aria-labelledby="complete-heading"
          className="rounded-card border-success/35 bg-success-soft/50 mt-5 border p-5 motion-safe:animate-[ec-rise_360ms_ease-out]"
        >
          <div className="flex items-center gap-3">
            <CheckMark className="size-10" />
            <div className="min-w-0">
              <p className="text-success text-xs font-semibold tracking-wide uppercase">
                Course complete
              </p>
              <h2
                id="complete-heading"
                className="font-display text-ink text-lg font-bold text-balance"
              >
                You finished {data.courseTitle}
              </h2>
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt className="text-muted text-xs">Finished</dt>
              <dd className="text-ink font-medium">
                {formatDateInZone(data.completion.completedAt, data.timeZone)}
              </dd>
            </div>
            <div>
              <dt className="text-muted text-xs">Lessons</dt>
              <dd className="text-ink font-medium">{data.completion.lessons}</dd>
            </div>
            {data.completion.quizzes.map((q) => (
              <div key={q.lessonTitle}>
                <dt className="text-muted text-xs">{q.lessonTitle}</dt>
                <dd className="text-ink font-medium">Passed · {q.scorePercent}%</dd>
              </div>
            ))}
            {data.completion.signedOff.map((s) => (
              <div key={s.lessonTitle}>
                <dt className="text-muted text-xs">{s.lessonTitle}</dt>
                <dd className="text-ink font-medium">Signed off by {s.byName}</dd>
              </div>
            ))}
          </dl>
          <p className="text-muted mt-4 text-sm">
            This is on your training record, and your manager can see it.
          </p>
        </section>
      ) : (
        <Card className="mt-5 p-5">
          <ProgressBar
            value={progress.percent}
            label={`${progress.completed} of ${progress.total} lessons done`}
          />
          <p className="text-muted mt-2 text-sm">
            {progress.remaining === 0
              ? 'Every lesson is done.'
              : `${progress.remaining} ${progress.remaining === 1 ? 'lesson' : 'lessons'} left · about ${formatMinutes(progress.remainingMinutes)}`}
            {due ? ` · ${due}` : ''}
          </p>
          {data.note ? (
            <p className="rounded-control border-line bg-raise mt-4 border px-4 py-3 text-sm">
              <span className="text-muted block text-xs">
                From {data.assignedByName ?? 'your manager'}
              </span>
              <span className="text-ink">{data.note}</span>
            </p>
          ) : null}
          {next ? (
            <ButtonLink
              href={`/my/training/${data.id}/lessons/${next.id}`}
              size="lg"
              className="mt-4 w-full"
            >
              {progress.completed === 0 && next.state === 'not_started' ? 'Start' : 'Continue'}
              <span className="sr-only">: {next.title}</span>
            </ButtonLink>
          ) : (
            <p className="rounded-control text-ink mt-4 border border-teal-200 bg-teal-50 px-4 py-3 text-sm">
              Waiting for a manager to sign off your practical. There is nothing else to do until
              then.
            </p>
          )}
        </Card>
      )}

      <section aria-labelledby="lessons-heading" className="mt-7">
        <h2 id="lessons-heading" className="font-display text-ink mb-3 text-lg font-bold">
          Lessons
        </h2>
        <ol className="flex flex-col gap-2">
          {progress.lessons.map((lesson) => {
            const state = LESSON_STATE[lesson.state]
            const isNext = next?.id === lesson.id && data.status !== 'cancelled'
            return (
              <li key={lesson.id}>
                <Link
                  href={`/my/training/${data.id}/lessons/${lesson.id}`}
                  className={cn(
                    'rounded-card flex min-h-14 items-center gap-3 border bg-white px-4 py-3 hover:border-teal-300',
                    isNext ? 'border-teal-300 ring-1 ring-teal-200' : 'border-line',
                  )}
                >
                  {lesson.state === 'completed' ? (
                    <CheckMark />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="border-line-strong text-muted inline-flex size-6 shrink-0 items-center justify-center rounded-full border-2 text-[0.7rem] font-semibold tabular-nums"
                    >
                      {lesson.number}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="text-ink block text-sm font-medium">
                      {lesson.title}
                      {isNext ? <span className="sr-only"> (next)</span> : null}
                    </span>
                    <span className="text-muted block text-xs">
                      {LESSON_KIND_LABELS[lesson.kind]} · {lesson.estimatedMinutes} min
                    </span>
                  </span>
                  <Badge tone={state.tone}>{state.label}</Badge>
                </Link>
              </li>
            )
          })}
        </ol>
      </section>
    </EmployeeShell>
  )
}
