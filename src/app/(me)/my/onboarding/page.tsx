import type { Metadata } from 'next'
import Link from 'next/link'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { getProgressForEmployment } from '@/modules/onboarding/service'
import { Badge, Card, EmptyState, Logo, ProgressBar } from '@/ui/primitives'
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
  const { actor, activeOrganization } = await requireActorContext()

  const progress = await withTenant(actor.organizationId, (tx) =>
    getProgressForEmployment(tx, actor, actor.employmentId),
  )

  return (
    <div className="bg-raise flex min-h-screen flex-col">
      <header className="border-line border-b bg-white px-5 py-3">
        <div className="mx-auto flex w-full max-w-xl items-center justify-between gap-3">
          <Link href="/my" aria-label="Your work">
            <Logo size="h-8" eager />
          </Link>
          <Link href="/my" className="text-muted text-sm underline-offset-4 hover:underline">
            Back
          </Link>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-xl flex-1 px-5 py-7">
        <p className="text-faint text-xs font-semibold tracking-[0.1em] uppercase">
          {activeOrganization.organizationName}
        </p>
        <h1 className="font-display text-ink mt-1 text-2xl font-extrabold tracking-tight">
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
                    : progress.state === 'blocked'
                      ? 'danger'
                      : progress.state === 'overdue'
                        ? 'warning'
                        : 'violet'
                }
              />
              <div className="rounded-control mt-4 border border-violet-200 bg-violet-50 px-4 py-3">
                <p className="text-xs font-semibold tracking-wide text-violet-700 uppercase">
                  {progress.nextAction ? 'Next up' : 'All done'}
                </p>
                <p className="text-ink mt-1 font-medium">
                  {progress.nextAction ?? 'You have finished every required step. Nice work.'}
                </p>
              </div>
            </Card>

            <h2 className="font-display text-muted mt-7 mb-3 text-sm font-bold tracking-[0.06em] uppercase">
              Every step
            </h2>

            <ul className="flex flex-col gap-3">
              {progress.steps.map((step) => (
                <li key={step.id}>
                  <Card className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-ink font-medium">{step.title}</p>
                        <p className="text-muted mt-0.5 text-xs">
                          {step.awaitingPlatform
                            ? 'Waiting on EverCalm'
                            : !step.selfCompletable && step.status === 'pending'
                              ? 'A manager confirms this one'
                              : step.required
                                ? 'Required'
                                : 'Optional'}
                          {step.dueOn ? (
                            <span className="whitespace-nowrap"> · due {step.dueOn}</span>
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

                    {step.verifiedBy ? (
                      <p className="text-success mt-2 text-xs">Verified by {step.verifiedBy}</p>
                    ) : null}

                    {step.selfCompletable ? (
                      <div className="mt-3">
                        <StepActions stepProgressId={step.id} />
                      </div>
                    ) : step.status === 'pending' && !step.awaitingPlatform ? (
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
  const map: Record<string, { tone: 'success' | 'warning' | 'neutral' | 'violet'; label: string }> =
    {
      completed: { tone: 'success', label: 'Done' },
      blocked: { tone: 'warning', label: 'Waiting' },
      waived: { tone: 'neutral', label: 'Waived' },
      pending: { tone: 'violet', label: 'To do' },
    }
  const { tone, label } = map[status] ?? map.pending!
  return <Badge tone={tone}>{label}</Badge>
}
