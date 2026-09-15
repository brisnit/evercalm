import Link from 'next/link'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { listLocations } from '@/modules/org/service'
import { listEmployments, listExpiringCredentials } from '@/modules/people/service'
import { listProgress } from '@/modules/onboarding/service'
import { listInvitations } from '@/modules/invitations/service'
import { can, canAtAnyLocation } from '@/server/authz/can'
import { ForbiddenError } from '@/lib/errors'
import {
  Avatar,
  Badge,
  ButtonLink,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  ProgressRing,
  TextLink,
} from '@/ui/primitives'
import { attentionItems } from '@/modules/reports/attention'

export const dynamic = 'force-dynamic'

/**
 * Administration overview.
 *
 * Every figure on this page is something a person can act on, and each links
 * to where they would act. There is no headcount-for-its-own-sake tile and no
 * chart of nothing: if a system has not shipped, it is simply absent.
 */

async function safely<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    // A capability the actor lacks is not an error on a dashboard - that
    // section simply does not appear for them.
    if (error instanceof ForbiddenError) return fallback
    throw error
  }
}

export default async function AppOverviewPage() {
  const { actor } = await requireActorContext()

  const data = await withTenant(actor.organizationId, async (tx) => ({
    locations: await listLocations(tx, actor),
    people: await safely(() => listEmployments(tx, actor), []),
    onboarding: await safely(() => listProgress(tx, actor), []),
    credentials: await safely(() => listExpiringCredentials(tx, actor), []),
    invitations: await safely(() => listInvitations(tx, actor), []),
    attention: await attentionItems(tx, actor),
  }))

  const activePeople = data.people.filter((p) => p.status === 'active')

  const firstName = actor.displayName.split(' ')[0] ?? actor.displayName
  const mayViewPeople = canAtAnyLocation(actor, 'people.view')
  const mayViewOnboarding = canAtAnyLocation(actor, 'onboarding.view_progress')
  const mayInvite = canAtAnyLocation(actor, 'people.invite')

  return (
    <>
      <PageHeader
        title={`Good to see you, ${firstName}`}
        description={
          data.attention.length === 0
            ? 'Nothing needs a decision right now. Here is how things stand.'
            : `${data.attention.length} ${data.attention.length === 1 ? 'thing needs' : 'things need'} a decision.`
        }
        action={
          mayInvite ? (
            <ButtonLink href="/app/people/invite" variant="secondary">
              Invite someone
            </ButtonLink>
          ) : undefined
        }
      />

      <Card as="section" className="overflow-hidden">
        <div className="border-line flex flex-wrap items-baseline justify-between gap-2 border-b px-5 py-4">
          <h2 className="font-display text-ink text-lg font-bold">Needs you</h2>
          <p className="text-muted text-sm">Last 30 days, for the locations you look after</p>
        </div>
        {data.attention.length === 0 ? (
          <div className="flex items-center gap-3 px-5 py-5">
            <span
              aria-hidden="true"
              className="bg-success-soft text-success flex size-9 shrink-0 items-center justify-center rounded-full"
            >
              <svg viewBox="0 0 16 16" fill="none" className="size-4">
                <path
                  d="m3.5 8.5 3 3 6-7"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <p className="text-ink">
              Nothing needs a decision right now.{' '}
              <span className="text-muted">
                New requests, blocked work and sign-offs appear here.
              </span>
            </p>
          </div>
        ) : (
          <ul className="divide-line divide-y">
            {data.attention.map((item) => (
              <li key={item.key}>
                <Link
                  href={item.href}
                  className="group flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-violet-50/60"
                >
                  <span
                    className={
                      item.tone === 'urgent'
                        ? 'bg-danger-soft text-danger font-display flex h-10 min-w-10 shrink-0 items-center justify-center rounded-full px-2 text-base font-extrabold tabular-nums'
                        : 'bg-warning-soft text-warning font-display flex h-10 min-w-10 shrink-0 items-center justify-center rounded-full px-2 text-base font-extrabold tabular-nums'
                    }
                  >
                    {item.count}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-ink block font-semibold group-hover:underline group-hover:underline-offset-4">
                      {item.label}
                    </span>
                    <span className="text-muted block text-sm">
                      {item.area} · {item.detail}
                    </span>
                  </span>
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 16 16"
                    fill="none"
                    className="text-faint size-4 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:text-violet-700"
                  >
                    <path
                      d="M6 3.5 10.5 8 6 12.5"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-start">
        {mayViewOnboarding ? (
          <Card>
            <CardHeader
              title="Onboarding"
              description="Newest hires first, with whatever is blocking them."
              action={
                <TextLink href="/app/onboarding" className="text-sm">
                  View all
                </TextLink>
              }
            />
            <div className="p-5">
              {data.onboarding.length === 0 ? (
                <EmptyState
                  title="Nobody is onboarding right now"
                  description="When you invite someone and assign them a checklist, their progress appears here."
                />
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {data.onboarding.slice(0, 5).map((person) => (
                    <li key={person.assignmentId}>
                      <Link
                        href={`/app/people/${person.employmentId}`}
                        className="rounded-control border-line hover:bg-raise flex items-center gap-3 border px-3.5 py-3"
                      >
                        <ProgressRing value={person.percentComplete} label={person.employeeName} />
                        <span className="min-w-0 flex-1">
                          <span className="text-ink block truncate text-sm font-medium">
                            {person.employeeName}
                          </span>
                          <span className="text-muted block truncate text-xs">
                            {person.nextAction ?? 'All steps complete'}
                          </span>
                        </span>
                        <OnboardingStateBadge state={person.state} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        ) : null}

        <div className="flex flex-col gap-5">
          {mayViewPeople ? (
            <Card>
              <CardHeader
                title="Credentials to chase"
                description="Expired or expiring within 45 days."
              />
              <div className="p-5">
                {data.credentials.length === 0 ? (
                  <EmptyState
                    title="Everything current"
                    description="No licences or certifications need renewing in the next 45 days."
                  />
                ) : (
                  <ul className="flex flex-col gap-2.5">
                    {data.credentials.slice(0, 6).map((row) => (
                      <li
                        key={row.credential.id}
                        className="rounded-control border-line flex items-center gap-3 border px-3.5 py-2.5"
                      >
                        <Avatar name={row.employeeName} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="text-ink block truncate text-sm font-medium">
                            {row.employeeName}
                          </span>
                          <span className="text-muted block truncate text-xs">
                            {row.credential.name}
                          </span>
                        </span>
                        <Badge
                          tone={row.credential.expiryState === 'expired' ? 'danger' : 'warning'}
                        >
                          {row.credential.expiryState === 'expired'
                            ? 'Expired'
                            : `${row.credential.daysUntilExpiry}d`}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Your organization" />
            <dl className="divide-line divide-y">
              {[
                ['Active people', String(activePeople.length)],
                ['Locations', String(data.locations.length)],
                [
                  'Your access',
                  actor.grants.map((g) => g.roleName).join(', ') || 'No roles granted',
                ],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-4 px-5 py-3">
                  <dt className="text-muted text-sm">{label}</dt>
                  <dd className="text-ink text-right text-sm font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            {can(actor, 'org.manage_locations') ? (
              <div className="border-line border-t px-5 py-3">
                <TextLink href="/app/setup" className="text-sm">
                  Continue company setup
                </TextLink>
              </div>
            ) : null}
          </Card>
        </div>
      </div>
    </>
  )
}

export function OnboardingStateBadge({ state }: { state: string }) {
  const config: Record<
    string,
    { tone: 'neutral' | 'violet' | 'success' | 'warning' | 'danger'; label: string }
  > = {
    completed: { tone: 'success', label: 'Complete' },
    blocked: { tone: 'danger', label: 'Blocked' },
    overdue: { tone: 'warning', label: 'Overdue' },
    in_progress: { tone: 'violet', label: 'In progress' },
    not_started: { tone: 'neutral', label: 'Not started' },
  }
  const { tone, label } = config[state] ?? { tone: 'neutral' as const, label: state }
  return <Badge tone={tone}>{label}</Badge>
}
