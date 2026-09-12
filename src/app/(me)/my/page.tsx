import type { Metadata } from 'next'
import Link from 'next/link'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { listLocations } from '@/modules/org/service'
import { getEmployment, listCredentials } from '@/modules/people/service'
import { getProgressForEmployment } from '@/modules/onboarding/service'
import { Badge, Card, CardHeader, Logo, ProgressBar } from '@/ui/primitives'

export const metadata: Metadata = { title: 'My work' }
export const dynamic = 'force-dynamic'

/**
 * Employee home - mobile-first, and a separate information architecture from
 * /app rather than a narrowed version of it.
 *
 * Ordered by the product promise: what do I need to do next, then what have I
 * finished, then where do I work. Sections whose systems have not shipped are
 * absent rather than shown empty.
 */
export default async function MyWorkPage() {
  const { actor, activeOrganization } = await requireActorContext()

  const data = await withTenant(actor.organizationId, async (tx) => ({
    locations: await listLocations(tx, actor),
    me: await getEmployment(tx, actor, actor.employmentId),
    onboarding: await getProgressForEmployment(tx, actor, actor.employmentId),
    credentials: await listCredentials(tx, actor, actor.employmentId),
  }))

  const myLocations = data.locations.filter((l) => actor.locationIds.includes(l.id))
  const hasAdminAccess = actor.grants.some((g) => g.capabilities.size > 0)
  const firstName = actor.displayName.split(' ')[0] ?? actor.displayName
  const attentionCredentials = data.credentials.filter(
    (c) => c.expiryState === 'expired' || c.expiryState === 'expiring_soon',
  )

  return (
    <div className="bg-raise flex min-h-screen flex-col">
      <header className="border-line border-b bg-white px-5 py-3">
        <div className="mx-auto flex w-full max-w-xl items-center justify-between gap-3">
          <Logo height={22} priority />
          {hasAdminAccess ? (
            <Link href="/app" className="text-muted text-sm underline-offset-4 hover:underline">
              Administration
            </Link>
          ) : null}
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-xl flex-1 px-5 py-7">
        <p className="text-faint text-xs font-semibold tracking-[0.1em] uppercase">
          {activeOrganization.organizationName}
        </p>
        <h1 className="font-display text-ink mt-1 text-2xl font-extrabold tracking-tight">
          Hello, {firstName}
        </h1>
        <p className="text-muted mt-1 text-sm">
          {data.me.jobTitle ?? 'Team member'}
          {data.me.homeLocationName ? ` · ${data.me.homeLocationName}` : ''}
        </p>

        <div className="mt-6 flex flex-col gap-4">
          {data.onboarding ? (
            <Card className="overflow-hidden">
              <div className="border-line border-b bg-white px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-muted text-xs font-semibold tracking-wide uppercase">
                      {data.onboarding.nextAction ? 'Do this next' : 'Onboarding'}
                    </p>
                    <p className="font-display text-ink mt-1 text-lg font-bold text-balance">
                      {data.onboarding.nextAction ?? 'You are all caught up'}
                    </p>
                  </div>
                  {data.onboarding.state === 'blocked' ? (
                    <Badge tone="warning">Waiting</Badge>
                  ) : data.onboarding.state === 'overdue' ? (
                    <Badge tone="danger">Overdue</Badge>
                  ) : data.onboarding.state === 'completed' ? (
                    <Badge tone="success">Complete</Badge>
                  ) : null}
                </div>
              </div>
              <div className="px-5 py-4">
                <ProgressBar
                  value={data.onboarding.percentComplete}
                  label={`${data.onboarding.requiredDone} of ${data.onboarding.requiredTotal} required steps done`}
                  tone={
                    data.onboarding.state === 'completed'
                      ? 'success'
                      : data.onboarding.state === 'blocked'
                        ? 'danger'
                        : 'violet'
                  }
                />
                <Link
                  href="/my/onboarding"
                  className="rounded-control mt-4 inline-flex min-h-11 w-full items-center justify-center bg-violet-600 px-4 text-sm font-medium text-white hover:bg-violet-700"
                >
                  Open your onboarding
                </Link>
              </div>
            </Card>
          ) : null}

          {attentionCredentials.length > 0 ? (
            <Card>
              <CardHeader title="Your credentials need attention" />
              <ul className="divide-line divide-y">
                {attentionCredentials.map((credential) => (
                  <li
                    key={credential.id}
                    className="flex items-center justify-between gap-3 px-5 py-3"
                  >
                    <span className="min-w-0">
                      <span className="text-ink block truncate text-sm font-medium">
                        {credential.name}
                      </span>
                      <span className="text-muted block text-xs">
                        {credential.issuingAuthority ?? 'No issuing authority'}
                      </span>
                    </span>
                    <Badge tone={credential.expiryState === 'expired' ? 'danger' : 'warning'}>
                      {credential.expiryState === 'expired'
                        ? `Expired ${credential.expiresOn}`
                        : `${credential.daysUntilExpiry} days`}
                    </Badge>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Where you work" />
            <div className="p-5">
              {myLocations.length === 0 ? (
                <p className="text-muted text-sm">
                  You are not assigned to a location yet. Your manager can assign you one.
                </p>
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {myLocations.map((l) => (
                    <li
                      key={l.id}
                      className="rounded-control border-line flex items-center justify-between gap-3 border bg-white px-3.5 py-3"
                    >
                      <span className="text-ink text-sm font-medium">{l.name}</span>
                      {l.city ? <Badge tone="neutral">{l.city}</Badge> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          <Card className="border-dashed bg-transparent">
            <div className="p-5">
              <h2 className="font-display text-ink text-sm font-bold">Coming in later slices</h2>
              <p className="text-muted mt-1.5 text-sm">
                Your next shift, announcements to acknowledge, training that is due, and
                today&rsquo;s responsibilities will appear here. They are not built yet, so nothing
                on this screen pretends to show them.
              </p>
            </div>
          </Card>
        </div>
      </main>
    </div>
  )
}
