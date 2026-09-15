import type { Metadata } from 'next'
import Link from 'next/link'
import { PLATFORM_ROLE_LABELS, requirePlatformStaff, staffMay } from '@/server/auth/platform-staff'
import { staffOrganizations, staffWorkerErrors } from '@/server/db/platform'
import { Badge, Card, CardHeader, PageHeader, ScrollArea } from '@/ui/primitives'
import {
  INDUSTRY_LABELS,
  PLAN_LABELS,
  SUBSCRIPTION_LABELS,
  attentionReasons,
  labelFrom,
  utcDate,
  utcDateTime,
} from './format'

export const metadata: Metadata = { title: 'Organizations' }

/** Every customer organization: account state, and anything that needs the team. */
export default async function PlatformHomePage() {
  const staff = await requirePlatformStaff('directory')
  const [organizations, errors] = await Promise.all([
    staffOrganizations(staff.userId),
    staffWorkerErrors(staff.userId, null),
  ])
  // Anything that needs the team comes first; within that, the most reasons first.
  const ranked = organizations
    .map((o) => ({ o, reasons: attentionReasons(o) }))
    .sort((a, b) => b.reasons.length - a.reasons.length || a.o.name.localeCompare(b.o.name))
  const attention = ranked.filter((r) => r.reasons.length > 0)
  const permitted = [
    'view every organization',
    'work support cases',
    'open diagnostics',
    ...(staffMay(staff, 'retry_deliveries') ? ['retry failed deliveries'] : []),
    ...(staffMay(staff, 'set_subscription_status') ? ['set a pilot’s billing status'] : []),
  ]
  const needsAdmin = [
    ...(!staffMay(staff, 'retry_deliveries') ? ['retrying deliveries'] : []),
    ...(!staffMay(staff, 'set_subscription_status') ? ['changing billing status'] : []),
  ]

  return (
    <>
      <PageHeader
        title="Organizations"
        description={`${organizations.length} customer ${organizations.length === 1 ? 'organization' : 'organizations'}. Times are UTC.`}
      />
      <p className="rounded-card border-line text-muted mb-5 border bg-white px-4 py-3 text-sm">
        <span className="text-ink font-semibold">{PLATFORM_ROLE_LABELS[staff.role]}.</span> You can{' '}
        {permitted.join(', ')}.
        {needsAdmin.length > 0
          ? ` ${needsAdmin.join(' and ').replace(/^./, (c) => c.toUpperCase())} need a support administrator.`
          : ''}{' '}
        No one on the team can sign in as a customer or read their people’s records.
      </p>

      <Card as="section" className="mb-5">
        <CardHeader
          title="Needs attention"
          description={
            attention.length === 0
              ? 'Nothing needs the team right now.'
              : `${attention.length} ${attention.length === 1 ? 'organization' : 'organizations'}, most pressing first.`
          }
        />
        {attention.length > 0 ? (
          <ul className="divide-line divide-y">
            {attention.map(({ o, reasons }) => (
              <li key={o.organizationId}>
                <Link
                  href={`/platform/organizations/${o.organizationId}`}
                  className="group flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 hover:bg-violet-50/60"
                >
                  <span className="min-w-0">
                    <span className="text-ink block font-semibold group-hover:underline group-hover:underline-offset-4">
                      {o.name}
                    </span>
                    <span className="text-muted block text-xs">
                      {labelFrom(INDUSTRY_LABELS, o.industry)} · {labelFrom(PLAN_LABELS, o.plan)}
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    {reasons.map((r) => (
                      <Badge key={r.label} tone={r.tone}>
                        {r.label}
                      </Badge>
                    ))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
      <Card as="section">
        <CardHeader
          title="All organizations"
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
              {ranked.map(({ o }) => {
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
                        {labelFrom(INDUSTRY_LABELS, o.industry)}
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
                          {labelFrom(PLAN_LABELS, o.plan)}
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
                    <td className="px-4 py-3 tabular-nums">
                      {o.lastActivityAt ? (
                        utcDate(o.lastActivityAt)
                      ) : (
                        <span className="text-muted">No sign-ins yet</span>
                      )}
                    </td>
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
                    {org ? (
                      <Link
                        href={`/platform/organizations/${org.organizationId}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {org.name}
                      </Link>
                    ) : (
                      <span className="font-medium">Finding due work</span>
                    )}{' '}
                    · {e.step}
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
