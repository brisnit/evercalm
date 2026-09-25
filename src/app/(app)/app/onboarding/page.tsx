import type { Metadata } from 'next'
import { formatCalendarDate } from '@/lib/dates'
import Link from 'next/link'
import { cn } from '@/lib/cn'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { listProgress } from '@/modules/onboarding/service'
import { canAtAnyLocation } from '@/server/authz/can'
import { ForbiddenError } from '@/lib/errors'
import {
  Avatar,
  Badge,
  ButtonLink,
  Card,
  EmptyState,
  PageHeader,
  ProgressBar,
  TextLink,
} from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { ToolIcon } from '@/ui/patterns/tool-icon'

export const metadata: Metadata = { title: 'Onboarding' }
export const dynamic = 'force-dynamic'

/**
 * The onboarding board.
 *
 * Ordered by what needs a human: blocked first, then overdue, then everything
 * on track. A manager should be able to open this and know immediately who is
 * stuck and why, without filtering anything.
 */

const STATE_META: Record<
  string,
  { tone: 'danger' | 'warning' | 'accent' | 'neutral' | 'success'; label: string; heading: string }
> = {
  blocked: { tone: 'danger', label: 'Blocked', heading: 'Blocked — needs a decision' },
  overdue: { tone: 'warning', label: 'Overdue', heading: 'Overdue' },
  in_progress: { tone: 'accent', label: 'In progress', heading: 'On track' },
  not_started: { tone: 'neutral', label: 'Not started', heading: 'Not started' },
  completed: { tone: 'success', label: 'Complete', heading: 'Complete' },
}

const ORDER = ['blocked', 'overdue', 'in_progress', 'not_started', 'completed'] as const

// The two groups that want a manager are named in warm ink, so the eye lands
// on them first down a long board. The heading still says which group it is.
const HEADING_TONE: Record<string, string> = {
  blocked: 'text-action',
  overdue: 'text-action',
}

export default async function OnboardingBoardPage() {
  const { actor } = await requireActorContext()
  if (!canAtAnyLocation(actor, 'onboarding.view_progress')) {
    return <PermissionDenied capabilityLabel="View onboarding progress" />
  }

  const progress = await withTenant(actor.organizationId, async (tx) => {
    try {
      return await listProgress(tx, actor)
    } catch (error) {
      if (error instanceof ForbiddenError) return null
      throw error
    }
  })

  if (!progress) return <PermissionDenied capabilityLabel="View onboarding progress" />

  const grouped = ORDER.map((state) => ({
    state,
    meta: STATE_META[state]!,
    people: progress.filter((p) => p.state === state),
  })).filter((group) => group.people.length > 0)

  return (
    <>
      <PageHeader
        title="Onboarding"
        description="Everyone working through their first weeks, ordered by what needs you most."
        action={
          canAtAnyLocation(actor, 'people.invite') ? (
            <ButtonLink href="/app/people/invite" size="lg" data-testid="add-new-hire">
              <ToolIcon name="plus" className="size-5" />
              Add new hire
            </ButtonLink>
          ) : undefined
        }
      />

      {progress.length === 0 ? (
        <EmptyState
          title="Nobody is onboarding"
          description="Assign a checklist from someone's profile and their progress will appear here."
          action={
            <TextLink href="/app/people" className="text-sm">
              Go to the directory
            </TextLink>
          }
        />
      ) : (
        <div className="flex flex-col gap-8">
          {grouped.map((group) => (
            <section key={group.state} aria-labelledby={`group-${group.state}`}>
              <h2
                id={`group-${group.state}`}
                className={cn(
                  'font-display mb-3 text-sm font-bold tracking-[0.06em] uppercase',
                  HEADING_TONE[group.state] ?? 'text-muted',
                )}
              >
                {group.meta.heading} · {group.people.length}
              </h2>

              <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {group.people.map((person) => {
                  const blockedStep = person.steps.find(
                    (s) => s.status === 'blocked' && !s.awaitingPlatform,
                  )
                  return (
                    <li key={person.assignmentId}>
                      <Card className="flex h-full flex-col p-5">
                        <div className="flex items-start gap-3">
                          <Avatar name={person.employeeName} />
                          <div className="min-w-0 flex-1">
                            <Link
                              href={`/app/people/${person.employmentId}`}
                              className="text-ink block truncate font-medium underline-offset-4 hover:underline"
                            >
                              {person.employeeName}
                            </Link>
                            <p className="text-muted truncate text-xs">{person.templateName}</p>
                          </div>
                          <Badge tone={group.meta.tone}>{group.meta.label}</Badge>
                        </div>

                        <div className="mt-4">
                          <ProgressBar
                            value={person.percentComplete}
                            label={`${person.requiredDone} of ${person.requiredTotal} required`}
                            tone={
                              group.state === 'blocked'
                                ? 'danger'
                                : group.state === 'overdue'
                                  ? 'warning'
                                  : group.state === 'completed'
                                    ? 'success'
                                    : 'accent'
                            }
                          />
                        </div>

                        <div className="border-line mt-4 border-t pt-3">
                          <p className="text-muted text-xs font-semibold tracking-wide uppercase">
                            {blockedStep ? 'Blocked on' : 'Next'}
                          </p>
                          <p className="text-ink mt-1 text-sm">
                            {blockedStep?.title ?? person.nextAction ?? 'Everything is complete'}
                          </p>
                          {blockedStep?.blockedReason ? (
                            <p className="text-warning mt-1 text-xs">{blockedStep.blockedReason}</p>
                          ) : null}
                          {person.dueOn ? (
                            <p className="text-faint mt-2 text-xs tabular-nums">
                              Due {formatCalendarDate(person.dueOn)}
                            </p>
                          ) : null}
                        </div>
                      </Card>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  )
}
