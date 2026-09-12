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
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  ProgressRing,
} from '@/ui/primitives'
import { StatTile } from '@/ui/patterns/stat-tile'

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
  const { actor, activeOrganization } = await requireActorContext()

  const data = await withTenant(actor.organizationId, async (tx) => ({
    locations: await listLocations(tx, actor),
    people: await safely(() => listEmployments(tx, actor), []),
    onboarding: await safely(() => listProgress(tx, actor), []),
    credentials: await safely(() => listExpiringCredentials(tx, actor), []),
    invitations: await safely(() => listInvitations(tx, actor), []),
  }))

  const activePeople = data.people.filter((p) => p.status === 'active')
  const needsAttention = data.onboarding.filter(
    (o) => o.state === 'blocked' || o.state === 'overdue',
  )
  const inProgress = data.onboarding.filter(
    (o) => o.state === 'in_progress' || o.state === 'not_started',
  )
  const expiredCredentials = data.credentials.filter((c) => c.credential.expiryState === 'expired')
  const pendingInvitations = data.invitations.filter((i) => i.status === 'pending')

  const firstName = actor.displayName.split(' ')[0] ?? actor.displayName
  const mayViewPeople = canAtAnyLocation(actor, 'people.view')
  const mayViewOnboarding = canAtAnyLocation(actor, 'onboarding.view_progress')
  const mayInvite = canAtAnyLocation(actor, 'people.invite')

  return (
    <>
      <PageHeader
        eyebrow={activeOrganization.organizationName}
        title={`Good to see you, ${firstName}`}
        description="What needs your attention today."
        action={
          mayInvite ? (
            <Link
              href="/app/people/invite"
              className="rounded-control inline-flex min-h-11 items-center bg-violet-600 px-4 text-sm font-medium text-white hover:bg-violet-700"
            >
              Invite someone
            </Link>
          ) : undefined
        }
      />

      {mayViewPeople || mayViewOnboarding ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {mayViewOnboarding ? (
            <StatTile
              label="Onboarding stuck"
              value={needsAttention.length}
              detail={
                needsAttention.length === 0
                  ? 'Nobody is blocked or overdue'
                  : 'Blocked or past due — needs a decision'
              }
              href="/app/onboarding"
              tone={needsAttention.length > 0 ? 'urgent' : 'good'}
            />
          ) : null}
          {mayViewOnboarding ? (
            <StatTile
              label="Onboarding in flight"
              value={inProgress.length}
              detail={
                inProgress.length === 0 ? 'No new hires mid-onboarding' : 'New hires on track'
              }
              href="/app/onboarding"
            />
          ) : null}
          {mayViewPeople ? (
            <StatTile
              label="Credentials"
              value={data.credentials.length}
              detail={
                data.credentials.length === 0
                  ? 'None expiring in the next 45 days'
                  : `${expiredCredentials.length} expired, ${data.credentials.length - expiredCredentials.length} expiring soon`
              }
              href="/app/people?filter=credentials"
              tone={
                expiredCredentials.length > 0
                  ? 'urgent'
                  : data.credentials.length > 0
                    ? 'attention'
                    : 'good'
              }
            />
          ) : null}
          {mayInvite ? (
            <StatTile
              label="Invitations open"
              value={pendingInvitations.length}
              detail={
                pendingInvitations.length === 0
                  ? 'No invitations waiting'
                  : 'Sent and not yet accepted'
              }
              href="/app/people/invitations"
            />
          ) : null}
        </div>
      ) : null}

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-start">
        {mayViewOnboarding ? (
          <Card>
            <CardHeader
              title="Onboarding"
              description="Newest hires first, with whatever is blocking them."
              action={
                <Link
                  href="/app/onboarding"
                  className="text-sm font-medium text-violet-700 underline-offset-4 hover:underline"
                >
                  View all
                </Link>
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
                <Link
                  href="/app/setup"
                  className="text-sm font-medium text-violet-700 underline-offset-4 hover:underline"
                >
                  Continue company setup
                </Link>
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
