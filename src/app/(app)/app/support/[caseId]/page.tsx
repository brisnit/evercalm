import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { formatDateInZone } from '@/lib/dates'
import { NotFoundError } from '@/lib/errors'
import { isUuid } from '@/lib/uuid'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { can } from '@/server/authz/can'
import { clockLabel } from '@/modules/operations/items'
import { CATEGORY_LABELS, SEVERITY_LABELS, STATUS_LABELS, getCase } from '@/modules/support/service'
import { organizationTimeZone } from '@/modules/training/records'
import { BackLink, Badge, Card, CardHeader, PageHeader } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { CaseReply } from './case-reply'

export const metadata: Metadata = { title: 'Support case' }
export const dynamic = 'force-dynamic'

export default async function SupportCasePage({
  params,
  searchParams,
}: {
  params: Promise<{ caseId: string }>
  searchParams: Promise<{ opened?: string }>
}) {
  const { caseId } = await params
  const { opened } = await searchParams
  if (!isUuid(caseId)) notFound()
  const { actor } = await requireActorContext()
  if (!can(actor, 'support.manage'))
    return <PermissionDenied capabilityLabel="Contact EverCalm support" />
  const data = await withTenant(actor.organizationId, async (tx) => ({
    detail: await getCase(tx, actor, caseId),
    timeZone: await organizationTimeZone(tx, actor.organizationId),
  })).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound()
    throw error
  })
  const { detail, timeZone } = data
  const when = (d: Date) => `${formatDateInZone(d, timeZone)}, ${clockLabel(d, timeZone)}`
  const status = STATUS_LABELS[detail.status]

  return (
    <>
      <BackLink href="/app/support">Support</BackLink>
      <PageHeader
        eyebrow={detail.reference}
        title={detail.subject}
        description={`${CATEGORY_LABELS[detail.category]} · ${SEVERITY_LABELS[detail.severity].label} · opened by ${detail.createdByLabel} ${when(detail.createdAt)}`}
        action={<Badge tone={status.tone}>{status.label}</Badge>}
      />
      {opened ? (
        <p
          role="status"
          className="rounded-control border-success/30 bg-success-soft text-success mb-5 border px-3.5 py-3 text-sm font-medium"
        >
          Case {detail.reference} is open. EverCalm support will reply here.
        </p>
      ) : null}
      <div className="flex max-w-3xl flex-col gap-4">
        <Card as="section">
          <CardHeader title="What happened" />
          <p className="text-ink p-5 text-sm whitespace-pre-line">{detail.description}</p>
        </Card>
        <section aria-labelledby="updates-heading" className="flex flex-col gap-3">
          <h2 id="updates-heading" className="font-display text-ink text-lg font-bold">
            Updates
          </h2>
          {detail.messages.length === 0 ? (
            <p className="text-muted text-sm">No updates yet.</p>
          ) : null}
          {detail.messages.map((m) => (
            <article
              key={m.id}
              aria-label={`Update from ${m.authorLabel}`}
              className={
                m.authorType === 'evercalm'
                  ? 'rounded-card border border-violet-200 bg-violet-50/50 p-4'
                  : 'rounded-card border-line border bg-white p-4'
              }
            >
              <p className="text-muted text-xs">
                <span className="text-ink font-semibold">{m.authorLabel}</span> ·{' '}
                {when(m.createdAt)}
              </p>
              {m.body ? (
                <p className="text-ink mt-1.5 text-sm whitespace-pre-line">{m.body}</p>
              ) : null}
              {m.statusTo ? (
                <p className="text-muted mt-1.5 text-xs">
                  Status: {STATUS_LABELS[m.statusTo].label}
                </p>
              ) : null}
            </article>
          ))}
        </section>
        <Card as="section">
          <CardHeader
            title={detail.status === 'resolved' ? 'Still a problem?' : 'Add an update'}
            description={
              detail.status === 'resolved' ? 'Adding an update reopens the case.' : undefined
            }
          />
          <div className="p-5">
            <CaseReply caseId={detail.id} reopen={detail.status === 'resolved'} />
          </div>
        </Card>
      </div>
    </>
  )
}
