import type { Metadata } from 'next'
import Link from 'next/link'
import { formatDateInZone } from '@/lib/dates'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { can } from '@/server/authz/can'
import { getSystemStatus } from '@/modules/status/service'
import { organizationTimeZone } from '@/modules/training/records'
import { clockLabel } from '@/modules/operations/items'
import { Badge, Card, CardHeader, PageHeader } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { NoticeProvider } from '@/ui/patterns/notice-provider'
import { RetryButton } from './retry-button'

export const metadata: Metadata = { title: 'System status' }
export const dynamic = 'force-dynamic'

const WORKER: Record<
  string,
  { label: string; tone: 'success' | 'warning' | 'danger'; body: string }
> = {
  running: {
    label: 'Running',
    tone: 'success',
    body: 'Scheduled announcements, reminders and notifications are going out.',
  },
  delayed: {
    label: 'Delayed',
    tone: 'warning',
    body: 'Background work has not run in the last few minutes. Scheduled messages and reminders may be late. EverCalm is alerted to this.',
  },
  not_running: {
    label: 'Not running',
    tone: 'danger',
    body: 'Background work is not running, so scheduled announcements, reminders and email are waiting. Nothing is lost; it catches up when it restarts.',
  },
}

const CHANNELS: Record<string, string> = {
  email: 'Email',
  in_app: 'In EverCalm',
  sms: 'Text message',
  push: 'Push',
}

/**
 * Is EverCalm working for this organization? Only what an owner can act on,
 * and nothing about servers.
 */
export default async function SystemStatusPage() {
  const { actor } = await requireActorContext()
  if (!can(actor, 'org.view'))
    return <PermissionDenied capabilityLabel="View organization settings" />
  const { status, timeZone } = await withTenant(actor.organizationId, async (tx) => ({
    status: await getSystemStatus(tx, actor),
    timeZone: await organizationTimeZone(tx, actor.organizationId),
  }))
  const worker = WORKER[status.worker.state]!
  const when = (d: Date | null) =>
    d ? `${formatDateInZone(d, timeZone)}, ${clockLabel(d, timeZone)}` : 'never'
  const d = status.deliveries

  return (
    <NoticeProvider>
      <PageHeader
        title="System status"
        description="Whether background work is running for your organization, and anything that could not be delivered."
      />
      <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
        <Card as="section">
          <CardHeader
            title="Background work"
            action={<Badge tone={worker.tone}>{worker.label}</Badge>}
          />
          <div className="flex flex-col gap-2 p-5 text-sm">
            <p className="text-ink">{worker.body}</p>
            <p className="text-muted">Last ran {when(status.worker.lastFinishedAt)}.</p>
            {status.worker.errors24h > 0 ? (
              <p className="text-warning">
                {status.worker.errors24h} background{' '}
                {status.worker.errors24h === 1 ? 'task' : 'tasks'} for your organization hit a
                problem in the last day and will be tried again.
              </p>
            ) : null}
          </div>
        </Card>

        <Card as="section">
          <CardHeader title="Scheduled announcements" />
          <div className="p-5 text-sm">
            {status.publishing.failed === 0 ? (
              <p className="text-muted">
                Every scheduled announcement in the last 30 days published on time.
              </p>
            ) : (
              <p className="text-ink">
                {status.publishing.failed} scheduled{' '}
                {status.publishing.failed === 1 ? 'announcement' : 'announcements'} could not
                publish, most recently {when(status.publishing.lastFailedAt)}.{' '}
                <Link href="/app/comms" className="text-violet-700 underline underline-offset-4">
                  Review them in Communication
                </Link>
              </p>
            )}
          </div>
        </Card>

        <Card as="section" className="lg:col-span-2">
          <CardHeader title="Notification delivery" description="The last 7 days." />
          <dl className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4">
            {(
              [
                ['Delivered', d.sent],
                ['Waiting to send', d.pending],
                ['Could not deliver', d.failed],
                ['Held by preferences', d.suppressed],
              ] as [string, number][]
            ).map(([label, value]) => (
              <div key={label} className="rounded-control border-line border p-3">
                <dt className="text-muted text-xs">{label}</dt>
                <dd className="font-display text-ink text-xl font-bold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          {d.failures.length > 0 ? (
            <div className="border-line border-t">
              <h3 className="text-ink px-5 pt-4 text-sm font-semibold">Why deliveries failed</h3>
              <ul className="divide-line divide-y">
                {d.failures.map((f) => (
                  <li
                    key={`${f.channel}-${f.reason}`}
                    className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3 text-sm"
                  >
                    <span className="min-w-0">
                      <span className="text-ink">{f.reason}</span>
                      <span className="text-muted"> · {CHANNELS[f.channel] ?? f.channel}</span>
                    </span>
                    <span className="text-muted text-xs tabular-nums">
                      {f.count} · last {when(f.lastFailedAt)}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="border-line flex flex-wrap items-center gap-3 border-t px-5 py-4">
                {status.canRetry && d.retryable > 0 ? (
                  <RetryButton count={d.retryable} />
                ) : (
                  <p className="text-muted text-sm">
                    {d.retryable === 0
                      ? 'Nothing here will succeed by trying again. A missing email address is fixed on the person’s profile.'
                      : 'An owner can queue these to try again.'}
                  </p>
                )}
              </div>
            </div>
          ) : null}
        </Card>

        <Card as="section" className="p-5 lg:col-span-2">
          <p className="text-ink text-sm">
            Something not working?{' '}
            {can(actor, 'support.manage') ? (
              <Link
                href="/app/support/new"
                className="text-violet-700 underline underline-offset-4"
              >
                Open a support case
              </Link>
            ) : (
              'Ask an owner to open a support case.'
            )}
          </p>
        </Card>
      </div>
    </NoticeProvider>
  )
}
