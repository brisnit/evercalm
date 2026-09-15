import type { Metadata } from 'next'
import Link from 'next/link'
import { requirePlatformStaff } from '@/server/auth/platform-staff'
import { staffOrganizations, staffWorkerErrors } from '@/server/db/platform'
import { Badge, Card, CardHeader, PageHeader, ScrollArea } from '@/ui/primitives'
import { SUBSCRIPTION_LABELS, utcDate, utcDateTime } from './format'

export const metadata: Metadata = { title: 'Organizations' }

/** Every customer organization: account state, and anything that needs the team. */
export default async function PlatformHomePage() {
  const staff = await requirePlatformStaff('directory')
  const [organizations, errors] = await Promise.all([
    staffOrganizations(staff.userId),
    staffWorkerErrors(staff.userId, null),
  ])
  const attention = organizations.filter(
    (o) =>
      o.subscriptionStatus === 'past_due' ||
      o.subscriptionStatus === 'suspended' ||
      o.openCases > 0 ||
      o.failedNotifications7d > 0 ||
      o.publishFailures30d > 0,
  ).length

  return (
    <>
      <PageHeader
        eyebrow="EverCalm team"
        title="Organizations"
        description={`${organizations.length} customer ${organizations.length === 1 ? 'organization' : 'organizations'} · ${attention} with something to look at. Times are UTC.`}
      />
      <Card as="section">
        <CardHeader
          title="Accounts"
          description="Counts and statuses only. Employee records, messages and HR fields are not available to the EverCalm team."
        />
        <ScrollArea label="Organizations">
          <table className="w-full min-w-[56rem] text-left text-sm">
            <thead className="text-muted text-xs">
              <tr className="border-line border-b">
                {[
                  'Organization',
                  'Subscription',
                  'Trial or period ends',
                  'Locations',
                  'Active employees',
                  'Open cases',
                  'Failed deliveries (7d)',
                  'Publish failures (30d)',
                  'Last customer activity',
                ].map((h) => (
                  <th key={h} scope="col" className="px-4 py-2.5 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {organizations.map((o) => {
                const status = o.subscriptionStatus
                  ? SUBSCRIPTION_LABELS[o.subscriptionStatus]
                  : null
                return (
                  <tr key={o.organizationId}>
                    <th scope="row" className="px-4 py-3 font-normal">
                      <Link
                        href={`/platform/organizations/${o.organizationId}`}
                        className="text-ink font-semibold underline-offset-4 hover:underline"
                      >
                        {o.name}
                      </Link>
                      <span className="text-muted block text-xs">
                        {o.industry.replace(/_/g, ' ')}
                      </span>
                    </th>
                    <td className="px-4 py-3">
                      {status ? (
                        <Badge tone={status.tone}>{status.label}</Badge>
                      ) : (
                        <Badge tone="neutral">No subscription</Badge>
                      )}
                      {o.plan ? (
                        <span className="text-muted block text-xs">
                          {o.plan.replace(/_/g, ' ')}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {utcDate(
                        o.subscriptionStatus === 'trialing' ? o.trialEndsAt : o.currentPeriodEnd,
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{o.locations}</td>
                    <td className="px-4 py-3 tabular-nums">{o.activeEmployees}</td>
                    <td
                      className={`px-4 py-3 tabular-nums ${o.openCases > 0 ? 'text-warning font-semibold' : ''}`}
                    >
                      {o.openCases}
                    </td>
                    <td
                      className={`px-4 py-3 tabular-nums ${o.failedNotifications7d > 0 ? 'text-danger font-semibold' : ''}`}
                    >
                      {o.failedNotifications7d}
                    </td>
                    <td
                      className={`px-4 py-3 tabular-nums ${o.publishFailures30d > 0 ? 'text-danger font-semibold' : ''}`}
                    >
                      {o.publishFailures30d}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{utcDate(o.lastActivityAt)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </ScrollArea>
      </Card>

      <Card as="section" className="mt-5">
        <CardHeader
          title="Background work problems"
          description="Worker errors in the last 7 days, newest first."
        />
        {errors.length === 0 ? (
          <p className="text-muted p-5 text-sm">No background work errors in the last 7 days.</p>
        ) : (
          <ul className="divide-line divide-y">
            {errors.slice(0, 15).map((e, i) => {
              const org = organizations.find((o) => o.organizationId === e.organizationId)
              return (
                <li key={i} className="px-5 py-3 text-sm">
                  <p className="text-ink">
                    <span className="font-medium">{org?.name ?? 'Discovery'}</span> · {e.step}
                  </p>
                  <p className="text-muted text-xs">
                    {utcDateTime(e.finishedAt)} · {e.message}
                  </p>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </>
  )
}
