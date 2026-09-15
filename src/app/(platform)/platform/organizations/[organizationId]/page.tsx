import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { isUuid } from '@/lib/uuid'
import { requirePlatformStaff, staffMay } from '@/server/auth/platform-staff'
import {
  staffAuditSummary,
  staffBillingEvents,
  staffCases,
  staffDeliveryFailures,
  staffOrganizations,
  staffWorkerErrors,
} from '@/server/db/platform'
import { openDiagnosticsAction } from '@/modules/platform/actions'
import { diagnosticsOpenUntil } from '@/modules/platform/diagnostics'
import { Badge, Button, Card, CardHeader, PageHeader } from '@/ui/primitives'
import { NoticeProvider } from '@/ui/patterns/notice-provider'
import {
  CASE_STATUS_LABELS,
  SEVERITY_TONES,
  SUBSCRIPTION_LABELS,
  utcDate,
  utcDateTime,
} from '../../format'
import { RetryDeliveries } from './retry-deliveries'

export const metadata: Metadata = { title: 'Organization' }

export default async function PlatformOrganizationPage({
  params,
}: {
  params: Promise<{ organizationId: string }>
}) {
  const { organizationId } = await params
  if (!isUuid(organizationId)) notFound()
  const staff = await requirePlatformStaff('directory')
  const [org] = await staffOrganizations(staff.userId, organizationId)
  if (!org) notFound()
  const [billing, cases, openUntil] = await Promise.all([
    staffBillingEvents(staff.userId, organizationId),
    staffCases(staff.userId, { organizationId }),
    diagnosticsOpenUntil(organizationId),
  ])
  const diagnostics =
    openUntil && staffMay(staff, 'diagnostics')
      ? await Promise.all([
          staffDeliveryFailures(staff.userId, organizationId),
          staffWorkerErrors(staff.userId, organizationId),
          staffAuditSummary(staff.userId, organizationId, 30),
        ])
      : null
  const status = org.subscriptionStatus ? SUBSCRIPTION_LABELS[org.subscriptionStatus] : null

  return (
    <NoticeProvider>
      <Link href="/platform" className="text-muted text-sm underline-offset-4 hover:underline">
        ← Organizations
      </Link>
      <PageHeader
        eyebrow="EverCalm team · Organization"
        title={org.name}
        description={`${org.industry.replace(/_/g, ' ')} · ${org.slug} · customer since ${utcDate(org.createdAt)}`}
        action={status ? <Badge tone={status.tone}>{status.label}</Badge> : null}
      />
      <p className="rounded-control border-line text-muted mb-5 border bg-white px-4 py-3 text-sm">
        The EverCalm team cannot sign in as anyone in this organization, read their messages, or see
        employee records. Diagnostics show counts and reasons only, and opening them is recorded in
        the organization’s audit log.
      </p>

      <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
        <Card as="section">
          <CardHeader title="Account" />
          <dl className="grid grid-cols-2 gap-4 p-5 text-sm">
            <Stat label="Locations" value={org.locations} />
            <Stat label="Active employees" value={org.activeEmployees} />
            <Stat label="Open support cases" value={org.openCases} />
            <Stat label="Last customer activity" value={utcDateTime(org.lastActivityAt)} />
            <Stat label="Failed deliveries (7 days)" value={org.failedNotifications7d} />
            <Stat label="Publish failures (30 days)" value={org.publishFailures30d} />
          </dl>
        </Card>

        <Card as="section">
          <CardHeader title="Subscription" />
          <dl className="grid grid-cols-2 gap-4 p-5 text-sm">
            <Stat label="Plan" value={org.plan?.replace(/_/g, ' ') ?? 'None'} />
            <Stat label="Status" value={status?.label ?? 'No subscription'} />
            <Stat label="Trial ends" value={utcDate(org.trialEndsAt)} />
            <Stat label="Period ends" value={utcDate(org.currentPeriodEnd)} />
            <Stat label="Cancels at period end" value={org.cancelAtPeriodEnd ? 'Yes' : 'No'} />
            <Stat label="Payment overdue since" value={utcDate(org.pastDueSince)} />
            <Stat label="Payment method" value={org.hasPaymentMethod ? 'On file' : 'None'} />
            <Stat
              label="Billing contact"
              value={
                org.billingContactName
                  ? `${org.billingContactName} · ${org.billingContactEmail}`
                  : 'Not set'
              }
            />
          </dl>
          {billing.length > 0 ? (
            <ol className="divide-line border-line divide-y border-t">
              {billing.slice(0, 8).map((b, i) => (
                <li key={i} className="flex flex-wrap justify-between gap-2 px-5 py-2.5 text-sm">
                  <span className="text-ink">{b.summary}</span>
                  <span className="text-muted text-xs">
                    {utcDateTime(b.occurredAt)} · {b.source}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
        </Card>

        <Card as="section" className="lg:col-span-2">
          <CardHeader title="Support cases" />
          {cases.length === 0 ? (
            <p className="text-muted p-5 text-sm">No support cases.</p>
          ) : (
            <ul className="divide-line divide-y">
              {cases.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm"
                >
                  <Link
                    href={`/platform/support/${c.id}`}
                    className="text-ink min-w-0 font-medium underline-offset-4 hover:underline"
                  >
                    {c.reference} · {c.subject}
                  </Link>
                  <span className="flex gap-2">
                    <Badge tone={SEVERITY_TONES[c.severity] ?? 'neutral'}>{c.severity}</Badge>
                    <Badge tone={CASE_STATUS_LABELS[c.status]?.tone ?? 'info'}>
                      {CASE_STATUS_LABELS[c.status]?.label ?? c.status}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card as="section" className="lg:col-span-2">
          <div id="diagnostics" className="scroll-mt-4">
            <CardHeader
              title="Diagnostics"
              description={
                diagnostics
                  ? `Open until ${utcDateTime(openUntil)}. Recorded in the organization’s audit log.`
                  : 'Delivery failures, background errors and an audit summary. Opening them is recorded in the organization’s audit log and lasts 15 minutes.'
              }
            />
          </div>
          {!diagnostics ? (
            <form action={openDiagnosticsAction} className="p-5">
              <input type="hidden" name="organizationId" value={organizationId} />
              <Button type="submit" variant="secondary">
                Open diagnostics
              </Button>
            </form>
          ) : (
            <div className="grid gap-5 p-5 lg:grid-cols-3 [&>*]:min-w-0">
              <section aria-labelledby="failures-heading">
                <h3 id="failures-heading" className="text-ink text-sm font-semibold">
                  Delivery failures (30 days)
                </h3>
                {diagnostics[0].length === 0 ? (
                  <p className="text-muted mt-2 text-sm">None.</p>
                ) : (
                  <ul className="mt-2 flex flex-col gap-2 text-sm">
                    {diagnostics[0].map((f, i) => (
                      <li key={i}>
                        <span className="text-ink">{f.failureReason}</span>
                        <span className="text-muted block text-xs">
                          {f.failures} · {f.channel} · {f.category} · last{' '}
                          {utcDateTime(f.lastFailedAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {staffMay(staff, 'retry_deliveries') && diagnostics[0].length > 0 ? (
                  <div className="mt-4">
                    <RetryDeliveries organizationId={organizationId} />
                  </div>
                ) : null}
              </section>
              <section aria-labelledby="worker-heading">
                <h3 id="worker-heading" className="text-ink text-sm font-semibold">
                  Background errors (7 days)
                </h3>
                {diagnostics[1].length === 0 ? (
                  <p className="text-muted mt-2 text-sm">None.</p>
                ) : (
                  <ul className="mt-2 flex flex-col gap-2 text-sm">
                    {diagnostics[1].map((e, i) => (
                      <li key={i}>
                        <span className="text-ink">{e.step}</span>
                        <span className="text-muted block text-xs">
                          {utcDateTime(e.finishedAt)} · {e.message}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section aria-labelledby="audit-heading">
                <h3 id="audit-heading" className="text-ink text-sm font-semibold">
                  Activity (30 days)
                </h3>
                <ul className="mt-2 flex flex-col gap-1 text-sm">
                  {diagnostics[2].slice(0, 15).map((a) => (
                    <li key={`${a.action}-${a.actorType}`} className="flex justify-between gap-2">
                      <span className="text-ink min-w-0 truncate">
                        {a.action}
                        {a.actorType !== 'user' ? (
                          <span className="text-muted"> · {a.actorType}</span>
                        ) : null}
                      </span>
                      <span className="text-muted tabular-nums">{a.events}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-muted mt-3 text-xs">
                  Service checks:{' '}
                  <a href="/api/health" className="text-violet-700 underline underline-offset-4">
                    health
                  </a>{' '}
                  ·{' '}
                  <a href="/api/ready" className="text-violet-700 underline underline-offset-4">
                    readiness
                  </a>
                </p>
              </section>
            </div>
          )}
        </Card>
      </div>
    </NoticeProvider>
  )
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted text-xs">{label}</dt>
      <dd className="text-ink mt-0.5 font-medium break-words">{value}</dd>
    </div>
  )
}
