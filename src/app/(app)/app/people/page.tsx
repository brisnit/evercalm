import type { Metadata } from 'next'
import Link from 'next/link'
import { requireActorContext } from '@/server/auth/session'
import { employmentStatusLabel, ONBOARDING_STATE_LABELS } from '@/modules/people/labels'
import { withTenant } from '@/server/db'
import { listEmployments } from '@/modules/people/service'
import { listLocations } from '@/modules/org/service'
import { listProgress } from '@/modules/onboarding/service'
import { can, canAtAnyLocation } from '@/server/authz/can'
import { ForbiddenError } from '@/lib/errors'
import { Avatar, Badge, ButtonLink, Card, EmptyState, PageHeader, TextLink } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { PeopleFilters } from './filters'

export const metadata: Metadata = { title: 'People' }
export const dynamic = 'force-dynamic'

/**
 * The employee directory.
 *
 * Resolves entirely through `employments`, never the global identity table -
 * see docs/architecture.md. A location-scoped manager sees only the people at
 * their own location, which the service enforces rather than the view.
 *
 * Responsive by structure rather than by hiding: a table on desktop, stacked
 * cards on a phone, both rendering the same rows.
 */

const STATUS_TONE: Record<string, 'success' | 'warning' | 'neutral' | 'danger'> = {
  active: 'success',
  invited: 'warning',
  suspended: 'warning',
  separated: 'neutral',
}

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; location?: string; status?: string }>
}) {
  const { actor } = await requireActorContext()
  if (!canAtAnyLocation(actor, 'people.view')) {
    return <PermissionDenied capabilityLabel="View people" />
  }

  const params = await searchParams
  const query = params.q?.trim() ?? ''
  const locationId = params.location ?? ''
  const status = params.status ?? ''

  const data = await withTenant(actor.organizationId, async (tx) => {
    try {
      return {
        people: await listEmployments(tx, actor, {
          query: query || undefined,
          locationId: locationId || undefined,
          status: status || undefined,
        }),
        locations: await listLocations(tx, actor),
        onboarding: await listProgress(tx, actor).catch(() => []),
      }
    } catch (error) {
      if (error instanceof ForbiddenError) return null
      throw error
    }
  })

  if (!data) return <PermissionDenied capabilityLabel="View people" />

  const onboardingByPerson = new Map(data.onboarding.map((o) => [o.employmentId, o]))
  const filtered = query || locationId || status

  return (
    <>
      <PageHeader
        title="Employee directory"
        description="Everyone employed by this organization, and where they work."
        action={
          can(actor, 'people.invite') || canAtAnyLocation(actor, 'people.invite') ? (
            <div className="flex flex-wrap gap-2">
              <ButtonLink href="/app/people/invitations" variant="secondary">
                Invitations
              </ButtonLink>
              <ButtonLink href="/app/people/import" variant="secondary">
                Import
              </ButtonLink>
              <ButtonLink href="/app/people/invite">Invite someone</ButtonLink>
            </div>
          ) : undefined
        }
      />

      <PeopleFilters locations={data.locations} />

      <p className="text-muted mt-4 mb-3 text-sm" aria-live="polite">
        {data.people.length} {data.people.length === 1 ? 'person' : 'people'}
        {filtered ? ' matching your filters' : ''}
      </p>

      {data.people.length === 0 ? (
        <EmptyState
          title={filtered ? 'Nobody matches those filters' : 'No people yet'}
          description={
            filtered
              ? 'Try a different name, location, or status.'
              : 'Invite your first team member to get started.'
          }
          action={
            filtered ? (
              <TextLink href="/app/people" className="text-sm">
                Clear filters
              </TextLink>
            ) : undefined
          }
        />
      ) : (
        <Card>
          {/*
            ONE table, not a table plus a duplicated mobile list. Duplicating
            every row would double the DOM on a large directory and make each
            person appear twice to tooling. Instead the secondary columns hide
            at phone width and their content moves under the name.
          */}
          <table className="w-full text-sm">
            <caption className="sr-only">Employee directory</caption>
            <thead>
              <tr className="border-line-strong bg-sunk border-b text-left">
                <th
                  scope="col"
                  className="text-muted px-4 py-3 text-xs font-semibold tracking-wide uppercase sm:px-5"
                >
                  Name
                </th>
                <th
                  scope="col"
                  className="text-muted hidden px-5 py-3 text-xs font-semibold tracking-wide uppercase md:table-cell"
                >
                  Location
                </th>
                <th
                  scope="col"
                  className="text-muted px-4 py-3 text-xs font-semibold tracking-wide uppercase sm:px-5"
                >
                  Status
                </th>
                <th
                  scope="col"
                  className="text-muted hidden px-5 py-3 text-xs font-semibold tracking-wide uppercase lg:table-cell"
                >
                  Onboarding
                </th>
              </tr>
            </thead>
            <tbody>
              {data.people.map((person) => {
                const onboarding = onboardingByPerson.get(person.employmentId)
                return (
                  <tr key={person.employmentId} className="border-line border-b last:border-b-0">
                    <td className="px-4 py-3 sm:px-5">
                      <Link
                        href={`/app/people/${person.employmentId}`}
                        className="text-ink flex items-center gap-3 font-medium underline-offset-4 hover:underline"
                      >
                        <Avatar name={person.displayName} size="sm" />
                        <span className="min-w-0">
                          <span className="block truncate">{person.displayName}</span>
                          <span className="text-muted block truncate text-xs font-normal">
                            {person.jobTitle ?? 'No job title'}
                          </span>
                          {/* On a phone the hidden columns move here. */}
                          <span className="text-faint block truncate text-xs font-normal md:hidden">
                            {person.homeLocationName ?? 'No location'}
                            {onboarding ? ` · onboarding ${onboarding.percentComplete}%` : ''}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="text-muted hidden px-5 py-3 md:table-cell">
                      {person.homeLocationName ?? '—'}
                    </td>
                    <td className="px-4 py-3 sm:px-5">
                      <Badge tone={STATUS_TONE[person.status] ?? 'neutral'}>
                        {employmentStatusLabel(person.status)}
                      </Badge>
                    </td>
                    <td className="hidden px-5 py-3 lg:table-cell">
                      {onboarding ? (
                        <span className="text-muted tabular-nums">
                          {onboarding.percentComplete}% ·{' '}
                          {ONBOARDING_STATE_LABELS[onboarding.state] ?? onboarding.state}
                        </span>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}
    </>
  )
}
