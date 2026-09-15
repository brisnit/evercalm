import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { isUuid } from '@/lib/uuid'
import { requirePlatformStaff } from '@/server/auth/platform-staff'
import { staffCaseThread, staffCases, staffColleagues } from '@/server/db/platform'
import { BackLink, Badge, Card, CardHeader, PageHeader } from '@/ui/primitives'
import { CASE_STATUS_LABELS, SEVERITY_TONES, utcDateTime } from '../../format'
import { StaffCaseControls } from './staff-case-controls'

export const metadata: Metadata = { title: 'Support case' }

export default async function PlatformCasePage({
  params,
}: {
  params: Promise<{ caseId: string }>
}) {
  const { caseId } = await params
  if (!isUuid(caseId)) notFound()
  const staff = await requirePlatformStaff('support')
  const [[detail], thread, colleagues] = await Promise.all([
    staffCases(staff.userId, { caseId }),
    staffCaseThread(staff.userId, caseId),
    staffColleagues(),
  ])
  if (!detail) notFound()
  const status = CASE_STATUS_LABELS[detail.status]

  return (
    <>
      <BackLink href="/platform/support">Support cases</BackLink>
      <PageHeader
        eyebrow={`${detail.reference} · ${detail.organizationName}`}
        title={detail.subject}
        description={`${detail.category.replace(/_/g, ' ')} · opened by ${detail.createdByLabel} ${utcDateTime(detail.createdAt)}${detail.reopenedCount ? ` · reopened ${detail.reopenedCount}×` : ''}`}
        action={
          <span className="flex gap-2">
            <Badge tone={SEVERITY_TONES[detail.severity] ?? 'neutral'}>{detail.severity}</Badge>
            <Badge tone={status?.tone ?? 'info'}>{status?.label ?? detail.status}</Badge>
          </span>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start [&>*]:min-w-0">
        <div className="flex min-w-0 flex-col gap-4">
          <Card as="section">
            <CardHeader title="What the customer reported" />
            <p className="text-ink p-5 text-sm whitespace-pre-line">{detail.description}</p>
          </Card>
          <section aria-labelledby="thread-heading" className="flex flex-col gap-3">
            <h2 id="thread-heading" className="font-display text-ink text-lg font-bold">
              Conversation
            </h2>
            {thread.length === 0 ? <p className="text-muted text-sm">No updates yet.</p> : null}
            {thread.map((m) => (
              <article
                key={m.id}
                aria-label={
                  m.kind === 'internal'
                    ? `Internal note from ${m.authorLabel}`
                    : `Update from ${m.authorLabel}`
                }
                className={
                  m.kind === 'internal'
                    ? 'rounded-card border-warning/40 bg-warning-soft/40 border border-dashed p-4'
                    : m.kind === 'evercalm'
                      ? 'rounded-card border border-violet-200 bg-violet-50/50 p-4'
                      : 'rounded-card border-line border bg-white p-4'
                }
              >
                <p className="text-muted text-xs">
                  {m.kind === 'internal' ? (
                    <Badge tone="warning">Internal · never shown to the customer</Badge>
                  ) : null}{' '}
                  <span className="text-ink font-semibold">{m.authorLabel}</span> ·{' '}
                  {utcDateTime(m.createdAt)}
                </p>
                {m.body ? (
                  <p className="text-ink mt-1.5 text-sm whitespace-pre-line">{m.body}</p>
                ) : null}
                {m.statusTo ? (
                  <p className="text-muted mt-1.5 text-xs">
                    Status: {CASE_STATUS_LABELS[m.statusTo]?.label ?? m.statusTo}
                  </p>
                ) : null}
              </article>
            ))}
          </section>
        </div>
        <StaffCaseControls
          caseId={detail.id}
          status={detail.status}
          assignedStaffUserId={detail.assignedStaffUserId}
          colleagues={colleagues.map((c) => ({ userId: c.userId, name: c.displayName }))}
          statuses={Object.entries(CASE_STATUS_LABELS).map(([value, s]) => ({
            value,
            label: s.label,
          }))}
        />
      </div>
    </>
  )
}
