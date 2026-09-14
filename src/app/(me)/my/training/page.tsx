import type { Metadata } from 'next'
import Link from 'next/link'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { cn } from '@/lib/cn'
import { formatDateInZone } from '@/lib/dates'
import { LESSON_KIND_LABELS } from '@/modules/training/content'
import { myTraining, type MyAssignment } from '@/modules/training/learner'
import { dueLabel, formatMinutes } from '@/modules/training/progress'
import { Badge, Card, EmptyState, ProgressBar } from '@/ui/primitives'
import { EmployeeShell } from '../_components/employee-shell'
import { CheckMark } from './_components/check-mark'

export const metadata: Metadata = { title: 'Your training' }
export const dynamic = 'force-dynamic'

/**
 * The employee's training, phone-first.
 *
 * Three answers before anything else: what to do next (one clear button),
 * where they stand (done, to do, left), and then the detail. Nobody is
 * compared with anybody; a missed date is shown as the date.
 */
export default async function MyTrainingPage() {
  const { actor } = await requireActorContext()
  const { overview, timeZone } = await withTenant(actor.organizationId, (tx) =>
    myTraining(tx, actor),
  )
  const { active, completed, upNext } = overview

  return (
    <EmployeeShell>
      <h1 className="font-display text-ink text-2xl font-extrabold tracking-tight">
        Your training
      </h1>

      {active.length === 0 && completed.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No training yet"
            description="When your manager assigns you a course, it appears here with what to do first."
          />
        </div>
      ) : (
        <>
          <NextUp upNext={upNext} active={active} completedCount={completed.length} />

          <section aria-labelledby="standing-heading" className="mt-4">
            <h2 id="standing-heading" className="sr-only">
              Where you are
            </h2>
            <Card>
              <dl className="divide-line grid grid-cols-3 divide-x">
                <Figure
                  label="Completed"
                  value={completed.length}
                  unit={completed.length === 1 ? 'course' : 'courses'}
                />
                <Figure
                  label="To do"
                  value={active.length}
                  unit={active.length === 1 ? 'course' : 'courses'}
                />
                <Figure
                  label="Left"
                  value={overview.lessonsRemaining}
                  unit={
                    overview.lessonsRemaining === 0
                      ? 'lessons'
                      : `${overview.lessonsRemaining === 1 ? 'lesson' : 'lessons'} · ${formatMinutes(overview.minutesRemaining)}`
                  }
                />
              </dl>
            </Card>
          </section>

          {active.length > 0 ? (
            <section aria-labelledby="todo-heading" className="mt-7">
              <h2
                id="todo-heading"
                className="font-display text-muted mb-3 text-sm font-bold tracking-[0.06em] uppercase"
              >
                To do
              </h2>
              <ul className="flex flex-col gap-3">
                {active.map((a) => (
                  <li key={a.id}>
                    <TodoCard assignment={a} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {completed.length > 0 ? (
            <section aria-labelledby="done-heading" className="mt-7">
              <h2
                id="done-heading"
                className="font-display text-muted mb-3 text-sm font-bold tracking-[0.06em] uppercase"
              >
                Completed
              </h2>
              <ul className="flex flex-col gap-2">
                {completed.map((a) => (
                  <li key={a.id}>
                    <Link
                      href={`/my/training/${a.id}`}
                      className="rounded-card border-line flex min-h-14 items-center gap-3 border bg-white px-4 py-3 hover:border-violet-300"
                    >
                      <CheckMark />
                      <span className="min-w-0 flex-1">
                        <span className="text-ink block font-medium">{a.courseTitle}</span>
                        <span className="text-muted block text-xs">
                          Completed {a.completedAt ? formatDateInZone(a.completedAt, timeZone) : ''}{' '}
                          · version {a.versionNumber}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </EmployeeShell>
  )
}

function Figure({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="flex flex-col items-center px-2 py-4 text-center">
      <dt className="text-muted text-[0.7rem] font-semibold tracking-[0.08em] uppercase">
        {label}
      </dt>
      <dd className="font-display text-ink mt-1 text-2xl font-extrabold tabular-nums">{value}</dd>
      <dd className="text-muted text-xs">{unit}</dd>
    </div>
  )
}

function NextUp({
  upNext,
  active,
  completedCount,
}: {
  upNext: MyAssignment | null
  active: MyAssignment[]
  completedCount: number
}) {
  if (upNext && upNext.progress.next) {
    const lesson = upNext.progress.next
    const due = dueLabel(upNext.dueOn, upNext.due)
    return (
      <Card as="section" className="mt-5 overflow-hidden border-violet-200">
        <div className="bg-violet-50 px-5 py-4">
          <p className="text-xs font-semibold tracking-wide text-violet-700 uppercase">Next up</p>
          <h2 className="font-display text-ink mt-1 text-xl font-bold text-balance">
            {lesson.title}
          </h2>
          <p className="text-muted mt-1 text-sm">
            {upNext.courseTitle} · Lesson {lesson.number} of {upNext.progress.total} ·{' '}
            {LESSON_KIND_LABELS[lesson.kind]} · {lesson.estimatedMinutes} min
          </p>
          {due ? (
            <p
              className={cn(
                'mt-2 text-sm font-medium',
                upNext.due.kind === 'past' ? 'text-warning' : 'text-ink',
              )}
            >
              {due}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-4 px-5 py-4">
          <ProgressBar
            value={upNext.progress.percent}
            label={`${upNext.progress.completed} of ${upNext.progress.total} lessons done`}
          />
          <Link
            href={`/my/training/${upNext.id}/lessons/${lesson.id}`}
            className="rounded-control inline-flex min-h-12 w-full items-center justify-center bg-violet-600 px-4 text-base font-semibold text-white hover:bg-violet-700"
          >
            {upNext.progress.completed === 0 && lesson.state === 'not_started'
              ? 'Start'
              : 'Continue'}
            <span className="sr-only">: {lesson.title}</span>
          </Link>
        </div>
      </Card>
    )
  }

  if (active.length > 0) {
    return (
      <Card as="section" className="mt-5 p-5">
        <h2 className="font-display text-ink text-lg font-bold">Nothing to do right now</h2>
        <p className="text-muted mt-1 text-sm">
          Your practical is waiting for a manager to sign it off. They will watch you and confirm
          it; there is nothing else for you to do until then.
        </p>
      </Card>
    )
  }

  return (
    <Card as="section" className="border-success/30 bg-success-soft/40 mt-5 p-5">
      <div className="flex items-center gap-3">
        <CheckMark className="size-8" />
        <div>
          <h2 className="font-display text-ink text-lg font-bold">You are all caught up</h2>
          <p className="text-muted text-sm">
            {completedCount} {completedCount === 1 ? 'course' : 'courses'} completed. New training
            appears here when it is assigned.
          </p>
        </div>
      </div>
    </Card>
  )
}

function TodoCard({ assignment: a }: { assignment: MyAssignment }) {
  const due = dueLabel(a.dueOn, a.due)
  const next = a.progress.next
  return (
    <Link
      href={`/my/training/${a.id}`}
      className="rounded-card border-line block border bg-white p-4 hover:border-violet-300"
    >
      <span className="flex items-start justify-between gap-3">
        <span className="text-ink font-medium">{a.courseTitle}</span>
        {!a.required ? <Badge tone="neutral">Optional</Badge> : null}
      </span>
      <span className="text-muted mt-0.5 block text-sm">
        {next ? `Next: ${next.title}` : 'Waiting for a manager to sign off your practical'}
      </span>
      <ProgressBar
        className="mt-3"
        value={a.progress.percent}
        label={`${a.progress.completed} of ${a.progress.total} lessons`}
      />
      {due ? (
        <span
          className={cn(
            'mt-2 block text-xs font-medium',
            a.due.kind === 'past' ? 'text-warning' : 'text-muted',
          )}
        >
          {due}
        </span>
      ) : null}
    </Link>
  )
}
