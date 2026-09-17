import type { Metadata } from 'next'
import { formatCalendarDate } from '@/lib/dates'
import { EmployeeHeader } from '../_components/employee-shell'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { getProgressForEmployment } from '@/modules/onboarding/service'
import { Badge, Card, EmptyState, ProgressBar } from '@/ui/primitives'
import { LinkedTrainingCard } from './linked-training'
import { StepActions } from './step-actions'

export const metadata: Metadata = { title: 'Your onboarding' }
export const dynamic = 'force-dynamic'

/**
 * Employee onboarding, mobile-first.
 *
 * Answers one question above everything else: what do I do next. The next
 * action is the first thing on the screen, before the full list.
 */
export default async function MyOnboardingPage() {
  const { actor } = await requireActorContext()

  const progress = await withTenant(actor.organizationId, (tx) =>
    getProgressForEmployment(tx, actor, actor.employmentId),
  )
  const nextStep = progress?.nextAction
    ? (progress.steps.find((s) => s.status === 'pending' && s.title === progress.nextAction) ??
      null)
    : null

  return (
    <div className="flex min-h-screen flex-col">
      <EmployeeHeader back={{ href: '/my', label: 'Back' }} />

      <main id="main" className="mx-auto w-full max-w-xl flex-1 px-5 py-7">
        <h1 className="font-display text-ink text-[1.625rem] leading-tight font-extrabold tracking-tight">
          Your onboarding
        </h1>

        {!progress ? (
          <div className="mt-6">
            <EmptyState
              title="Nothing assigned yet"
              description="Your manager has not set up an onboarding checklist for you. There is nothing you need to do right now."
            />
          </div>
        ) : (
          <>
            <Card className="mt-5 p-5">
              <ProgressBar
                value={progress.percentComplete}
                label={`${progress.requiredDone} of ${progress.requiredTotal} required steps done`}
                tone={
                  progress.state === 'completed'
                    ? 'success'
                    : progress.state === 'overdue'
                      ? 'warning'
                      : 'accent'
                }
              />
              {nextStep ? (
                <a
                  href={`#step-${nextStep.id}`}
                  className="rounded-control group mt-4 flex items-center justify-between gap-3 border border-teal-200 bg-teal-50 px-4 py-3 hover:border-teal-400"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-teal-700">Next up</span>
                    <span className="text-ink mt-0.5 block font-medium">{progress.nextAction}</span>
                  </span>
                  <span
                    aria-hidden="true"
                    className="text-teal-700 transition-transform group-hover:translate-y-0.5"
                  >
                    ↓
                  </span>
                </a>
              ) : (
                <div className="rounded-control border-success/30 bg-success-soft/50 mt-4 border px-4 py-3">
                  <p className="text-success text-sm font-semibold">
                    {progress.nextAction ? 'Next up' : 'All done'}
                  </p>
                  <p className="text-ink mt-0.5 font-medium">
                    {progress.nextAction ??
                      'You have finished every required step. Welcome to the team.'}
                  </p>
                </div>
              )}
            </Card>

            <h2 className="font-display text-ink mt-8 mb-3 text-lg font-bold">All steps</h2>

            <ul className="flex flex-col gap-3">
              {progress.steps.map((step) => (
                <li key={step.id} id={`step-${step.id}`} className="scroll-mt-6">
                  <Card className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-ink font-medium">{step.title}</p>
                        <p className="text-muted mt-0.5 text-xs">
                          {step.awaitingPlatform
                            ? 'Not ready yet'
                            : step.training
                              ? 'Completes with the course'
                              : !step.selfCompletable && step.status === 'pending'
                                ? 'A manager confirms this one'
                                : step.required
                                  ? 'Required'
                                  : 'Optional'}
                          {step.dueOn ? (
                            <span className="whitespace-nowrap">
                              {' '}
                              · due {formatCalendarDate(step.dueOn)}
                            </span>
                          ) : null}
                        </p>
                        {step.instructions ? (
                          <p className="text-muted mt-1.5 text-sm">{step.instructions}</p>
                        ) : null}
                      </div>
                      <StepStatusBadge status={step.status} />
                    </div>

                    {step.blockedReason ? (
                      <p className="rounded-control border-warning/30 bg-warning-soft text-ink mt-3 border px-3 py-2 text-sm">
                        {step.blockedReason}
                      </p>
                    ) : null}

                    {step.training ? <LinkedTrainingCard training={step.training} /> : null}

                    {step.verifiedBy ? (
                      <p className="text-success mt-2 text-xs">Verified by {step.verifiedBy}</p>
                    ) : null}

                    {step.selfCompletable ? (
                      <div className="mt-3">
                        <StepActions stepProgressId={step.id} />
                      </div>
                    ) : step.status === 'pending' && !step.awaitingPlatform && !step.training ? (
                      <p className="text-muted mt-3 text-sm">
                        Ask your manager to confirm this when you are ready.
                      </p>
                    ) : null}
                  </Card>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </div>
  )
}

function StepStatusBadge({ status }: { status: string }) {
  const map: Record<string, { tone: 'success' | 'warning' | 'neutral' | 'accent'; label: string }> =
    {
      completed: { tone: 'success', label: 'Done' },
      blocked: { tone: 'warning', label: 'Waiting' },
      waived: { tone: 'neutral', label: 'Waived' },
      pending: { tone: 'accent', label: 'To do' },
    }
  const { tone, label } = map[status] ?? map.pending!
  return <Badge tone={tone}>{label}</Badge>
}
