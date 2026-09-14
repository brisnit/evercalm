import type { Metadata } from 'next'
import { formatCalendarDate } from '@/lib/dates'
import Link from 'next/link'
import { and, eq, isNull } from 'drizzle-orm'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { roleGrants, roles, locations as locationsTable } from '@/server/db/schema'
import { getEmployment, listCredentials, listEmployments } from '@/modules/people/service'
import { listSeparations } from '@/modules/people/separation-service'
import { getProgressForEmployment } from '@/modules/onboarding/service'
import { listLocations } from '@/modules/org/service'
import { can, canAtAnyLocation } from '@/server/authz/can'
import { ForbiddenError, NotFoundError } from '@/lib/errors'
import { Avatar, Badge, Card, CardHeader, EmptyState, ProgressBar } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { EmploymentPanels, StartOnboardingForm } from './panels'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ employmentId: string }>
}): Promise<Metadata> {
  const { employmentId } = await params
  const { actor } = await requireActorContext()
  try {
    const person = await withTenant(actor.organizationId, (tx) =>
      getEmployment(tx, actor, employmentId),
    )
    return { title: person.displayName }
  } catch {
    return { title: 'Employee' }
  }
}

/**
 * The employee profile.
 *
 * Sensitive fields (date of birth, emergency contact, personal contact
 * details, licence numbers) are resolved by the SERVICE according to the
 * viewer's capabilities, not filtered in this view - a General Manager's
 * request never returns them at all. The page renders an explicit "withheld"
 * notice rather than silently omitting the section, so it is obvious that
 * information exists and is protected.
 */
export default async function EmployeeProfilePage({
  params,
}: {
  params: Promise<{ employmentId: string }>
}) {
  const { employmentId } = await params
  const { actor } = await requireActorContext()

  const data = await withTenant(actor.organizationId, async (tx) => {
    try {
      const person = await getEmployment(tx, actor, employmentId)
      const grants = await tx
        .select({
          grantId: roleGrants.id,
          roleKey: roles.key,
          roleName: roles.name,
          scope: roleGrants.scope,
          locationName: locationsTable.name,
        })
        .from(roleGrants)
        .innerJoin(
          roles,
          and(eq(roles.id, roleGrants.roleId), eq(roles.organizationId, roleGrants.organizationId)),
        )
        .leftJoin(
          locationsTable,
          and(
            eq(locationsTable.id, roleGrants.locationId),
            eq(locationsTable.organizationId, roleGrants.organizationId),
          ),
        )
        .where(
          and(
            eq(roleGrants.organizationId, actor.organizationId),
            eq(roleGrants.employmentId, employmentId),
            isNull(roleGrants.revokedAt),
          ),
        )

      return {
        person,
        grants,
        credentials: await listCredentials(tx, actor, employmentId),
        onboarding: await getProgressForEmployment(tx, actor, employmentId).catch(() => null),
        locations: await listLocations(tx, actor),
        colleagues: await listEmployments(tx, actor).catch(() => []),
        separations: await listSeparations(tx, actor).catch(() => []),
      }
    } catch (error) {
      if (error instanceof NotFoundError) return 'not_found' as const
      if (error instanceof ForbiddenError) return 'forbidden' as const
      throw error
    }
  })

  if (data === 'not_found') {
    return (
      <EmptyState
        title="We could not find that employee"
        description="They may have been removed, or the link may be wrong."
        action={
          <Link
            href="/app/people"
            className="text-sm font-medium text-violet-700 underline underline-offset-4"
          >
            Back to the directory
          </Link>
        }
      />
    )
  }
  if (data === 'forbidden') return <PermissionDenied capabilityLabel="View people" />

  const { person, onboarding } = data
  const openSeparation = data.separations.find(
    (s) =>
      s.employmentId === employmentId &&
      (s.status === 'pending_approval' || s.status === 'approved'),
  )

  const statusTone =
    person.status === 'active' ? 'success' : person.status === 'separated' ? 'neutral' : 'warning'

  // Same condition the management panels applied: somebody who can manage
  // employment, and not for a person who has already left.
  const mayStartOnboarding =
    canAtAnyLocation(actor, 'people.manage_employment') && person.status !== 'separated'

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3">
        <Link
          href="/app/people"
          className="text-muted hover:text-ink text-sm underline-offset-4 hover:underline"
        >
          ← People
        </Link>
      </nav>

      <div className="flex flex-wrap items-start gap-4 pb-6">
        <Avatar name={person.displayName} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-ink text-2xl font-extrabold tracking-tight sm:text-3xl">
            {person.displayName}
          </h1>
          <p className="text-muted mt-1">
            {person.jobTitle ?? 'No job title set'}
            {person.homeLocationName ? ` · ${person.homeLocationName}` : ''}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <Badge tone={statusTone}>{person.status}</Badge>
            {person.managerName ? (
              <span className="text-muted text-xs">Reports to {person.managerName}</span>
            ) : null}
            {openSeparation ? (
              <Badge tone="danger">
                Separation {openSeparation.status === 'approved' ? 'approved' : 'pending approval'}
              </Badge>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start">
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Employment" />
            <dl className="divide-line divide-y">
              {[
                ['Status', person.status],
                ['Hired', person.hiredOn ? formatCalendarDate(person.hiredOn) : 'Not recorded'],
                ['Home location', person.homeLocationName ?? 'None'],
                ['Reports to', person.managerName ?? 'Nobody'],
                ...(person.separatedOn
                  ? [['Separated', formatCalendarDate(person.separatedOn)]]
                  : []),
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-4 px-5 py-3">
                  <dt className="text-muted text-sm">{label}</dt>
                  <dd className="text-ink text-right text-sm font-medium capitalize">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card>
            <CardHeader
              title="Contact"
              description={
                person.contact
                  ? 'Personal details, visible to you because you hold the sensitive-information permission.'
                  : undefined
              }
            />
            <div className="p-5">
              {person.contact ? (
                <dl className="flex flex-col gap-3">
                  {[
                    ['Email', person.contact.email],
                    ['Phone', person.contact.phone],
                    ['Date of birth', person.contact.dateOfBirth],
                    ['Emergency contact', person.contact.emergencyContactName],
                    ['Emergency phone', person.contact.emergencyContactPhone],
                  ].map(([label, value]) => (
                    <div key={label} className="flex flex-wrap justify-between gap-2">
                      <dt className="text-muted text-sm">{label}</dt>
                      <dd className="text-ink text-sm font-medium">{value ?? 'Not recorded'}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <div className="rounded-control border-line bg-sunk border px-4 py-3">
                  <p className="text-ink text-sm font-medium">Withheld</p>
                  <p className="text-muted mt-1 text-sm">
                    Emergency contacts, date of birth and personal contact details need the
                    sensitive-information permission, which General Managers do not hold.
                  </p>
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Access" description="Roles granted, and where they apply." />
            <div className="p-5">
              {data.grants.length === 0 ? (
                <EmptyState
                  title="No roles granted"
                  description="This person can sign in and see their own work, but has no administrative access."
                />
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {data.grants.map((grant) => (
                    <li
                      key={grant.grantId}
                      className="rounded-control border-line flex flex-wrap items-center justify-between gap-2 border px-3.5 py-3"
                    >
                      <span className="min-w-0">
                        <span className="text-ink block text-sm font-medium">{grant.roleName}</span>
                        <span className="text-muted block text-xs">
                          {grant.scope === 'org'
                            ? 'Across the whole organization'
                            : `At ${grant.locationName ?? 'a location'}`}
                        </span>
                      </span>
                      <Badge tone={grant.scope === 'org' ? 'violet' : 'neutral'}>
                        {grant.scope === 'org' ? 'Organization' : 'Location'}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader
              title="Onboarding"
              action={
                onboarding ? (
                  <Link
                    href="/app/onboarding"
                    className="text-sm font-medium text-violet-700 underline-offset-4 hover:underline"
                  >
                    All onboarding
                  </Link>
                ) : undefined
              }
            />
            <div className="p-5">
              {onboarding ? (
                <>
                  <ProgressBar
                    value={onboarding.percentComplete}
                    label={`${onboarding.requiredDone} of ${onboarding.requiredTotal} required steps`}
                    tone={
                      onboarding.state === 'blocked'
                        ? 'danger'
                        : onboarding.state === 'overdue'
                          ? 'warning'
                          : onboarding.state === 'completed'
                            ? 'success'
                            : 'violet'
                    }
                  />
                  <p className="text-muted mt-3 text-sm">
                    {onboarding.nextAction
                      ? `Next: ${onboarding.nextAction}`
                      : 'Every required step is complete.'}
                  </p>
                  <ul className="mt-4 flex flex-col gap-1.5">
                    {onboarding.steps.map((step) => (
                      <li
                        key={step.id}
                        className="rounded-control border-line flex items-start gap-2.5 border px-3 py-2"
                      >
                        <StepMark status={step.status} />
                        <span className="min-w-0 flex-1">
                          <span className="text-ink block text-sm">{step.title}</span>
                          {step.training ? (
                            <span className="text-muted block text-xs">
                              {step.training.courseTitle}
                              {step.training.versionNumber !== null
                                ? `, version ${step.training.versionNumber}`
                                : ''}
                              {step.training.totalLessons > 0
                                ? ` · ${step.training.completedLessons} of ${step.training.totalLessons} lessons`
                                : ''}
                              {step.training.state === 'awaiting_signoff'
                                ? ' · waiting for sign-off'
                                : ''}
                            </span>
                          ) : null}
                          {step.blockedReason ? (
                            <span className="text-warning block text-xs">{step.blockedReason}</span>
                          ) : step.verifiedBy ? (
                            <span className="text-muted block text-xs">
                              Verified by {step.verifiedBy}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <EmptyState
                  title="Onboarding has not started"
                  description={
                    mayStartOnboarding
                      ? 'Assign the checklist matching this person\u2019s job role, or the default one.'
                      : 'Nobody has assigned this person a checklist yet.'
                  }
                  action={
                    mayStartOnboarding ? (
                      <StartOnboardingForm employmentId={employmentId} />
                    ) : undefined
                  }
                />
              )}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Credentials"
              description="Licences and certifications, with renewal dates."
            />
            <div className="p-5">
              {data.credentials.length === 0 ? (
                <EmptyState
                  title="No credentials recorded"
                  description="Record a licence or certification, and EverCalm will flag it before it expires."
                />
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {data.credentials.map((credential) => (
                    <li
                      key={credential.id}
                      className="rounded-control border-line flex flex-wrap items-center justify-between gap-2 border px-3.5 py-3"
                    >
                      <span className="min-w-0">
                        <span className="text-ink block text-sm font-medium">
                          {credential.name}
                        </span>
                        <span className="text-muted block text-xs">
                          {credential.issuingAuthority ?? 'No issuing authority'}
                          {credential.identifier ? ` · ${credential.identifier}` : ''}
                        </span>
                      </span>
                      <CredentialBadge
                        state={credential.expiryState}
                        days={credential.daysUntilExpiry}
                        expiresOn={credential.expiresOn}
                      />
                    </li>
                  ))}
                </ul>
              )}
              {!can(actor, 'people.view_sensitive') && data.credentials.length > 0 ? (
                <p className="text-faint mt-3 text-xs">
                  Licence numbers are hidden. Expiry dates are shown so you can plan cover.
                </p>
              ) : null}
            </div>
          </Card>
        </div>
      </div>

      {canAtAnyLocation(actor, 'people.update') ||
      canAtAnyLocation(actor, 'people.manage_employment') ||
      can(actor, 'org.manage_roles') ||
      can(actor, 'people.separate') ? (
        <div className="mt-5">
          <EmploymentPanels
            employmentId={employmentId}
            displayName={person.displayName}
            jobTitle={person.jobTitle ?? ''}
            status={person.status}
            managerEmploymentId={person.managerEmploymentId ?? ''}
            locations={data.locations}
            assignedLocationIds={person.locationIds}
            colleagues={data.colleagues
              .filter((c) => c.employmentId !== employmentId)
              .map((c) => ({ id: c.employmentId, name: c.displayName }))}
            openSeparation={
              openSeparation
                ? {
                    id: openSeparation.id,
                    status: openSeparation.status,
                    requestedBy: openSeparation.requestedBy,
                  }
                : null
            }
            permissions={{
              update: canAtAnyLocation(actor, 'people.update'),
              manageEmployment: canAtAnyLocation(actor, 'people.manage_employment'),
              manageRoles: can(actor, 'org.manage_roles'),
              manageCredentials: canAtAnyLocation(actor, 'people.manage_credentials'),
              separate: can(actor, 'people.separate'),
            }}
          />
        </div>
      ) : null}
    </>
  )
}

function StepMark({ status }: { status: string }) {
  const config: Record<string, { symbol: string; className: string; label: string }> = {
    completed: { symbol: '✓', className: 'bg-success text-white', label: 'Completed' },
    blocked: { symbol: '!', className: 'bg-warning text-white', label: 'Blocked' },
    waived: { symbol: '–', className: 'bg-sunk text-muted', label: 'Waived' },
    pending: { symbol: '', className: 'border border-line-strong bg-white', label: 'Not done yet' },
  }
  const { symbol, className, label } = config[status] ?? config.pending!
  return (
    <span
      className={`mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full text-[0.6rem] font-bold ${className}`}
    >
      <span className="sr-only">{label}</span>
      <span aria-hidden="true">{symbol}</span>
    </span>
  )
}

function CredentialBadge({
  state,
  days,
  expiresOn,
}: {
  state: string
  days: number | null
  expiresOn: string | null
}) {
  if (state === 'expired')
    return <Badge tone="danger">Expired {expiresOn ? formatCalendarDate(expiresOn) : ''}</Badge>
  if (state === 'expiring_soon') return <Badge tone="warning">Expires in {days} days</Badge>
  if (state === 'no_expiry') return <Badge tone="neutral">No expiry</Badge>
  return <Badge tone="success">Valid to {expiresOn ? formatCalendarDate(expiresOn) : ''}</Badge>
}
