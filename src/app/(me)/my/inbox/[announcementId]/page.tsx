import type { Metadata } from 'next'
import { EmployeeHeader } from '../../_components/employee-shell'
import { notFound } from 'next/navigation'
import { NotFoundError } from '@/lib/errors'
import { isUuid } from '@/lib/uuid'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { openAnnouncement, outstandingAcknowledgement } from '@/modules/comms/inbox'
import { organizationTimeZone } from '@/modules/comms/service'
import { formatDateInZone } from '@/lib/dates'
import { isSafeHref } from '@/modules/comms/content'
import { BackLink, Badge, ButtonLink, Card } from '@/ui/primitives'
import { AnnouncementBody } from '@/ui/patterns/announcement-body'
import { PriorityMark } from '@/ui/patterns/priority-mark'
import { AcknowledgementPanel } from './acknowledgement-panel'

export const metadata: Metadata = { title: 'Message' }
export const dynamic = 'force-dynamic'

/**
 * One announcement.
 *
 * Opening this page records a VIEW. It never records an acknowledgement -
 * that needs the button below, pressed deliberately. The two are separated
 * everywhere, and the page says which has happened rather than implying it.
 */
export default async function AnnouncementPage({
  params,
}: {
  params: Promise<{ announcementId: string }>
}) {
  const { announcementId } = await params
  if (!isUuid(announcementId)) notFound()
  const { actor } = await requireActorContext()

  // A message that is not theirs, or does not exist, is the same answer: not
  // found. An uncaught domain error would be a 500 with a stack trace, which
  // is both the wrong status and more than we want to say.
  const { detail, timeZone } = await withTenant(actor.organizationId, async (tx) => ({
    detail: await openAnnouncement(tx, actor, actor.employmentId, announcementId),
    timeZone: await organizationTimeZone(tx, actor.organizationId),
  })).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound()
    throw error
  })

  const dateLabel = (value: Date) => formatDateInZone(value, timeZone)
  const needsAck = outstandingAcknowledgement(detail)
  const overdue =
    needsAck &&
    detail.acknowledgementDueAt !== null &&
    detail.acknowledgementDueAt.getTime() < Date.now()

  return (
    <div className="flex min-h-screen flex-col">
      <EmployeeHeader back={{ href: '/my/inbox', label: 'Inbox' }} />

      <main id="main" className="mx-auto w-full max-w-xl flex-1 px-5 py-7">
        <nav aria-label="Breadcrumb" className="mb-3">
          <BackLink href="/my/inbox">Your inbox</BackLink>
        </nav>

        <div className="flex flex-wrap items-center gap-2">
          <PriorityMark priority={detail.priority} />
          <span className="text-faint text-xs font-semibold tracking-[0.1em] uppercase">
            {detail.categoryName}
          </span>
          {detail.status === 'expired' ? <Badge tone="neutral">Expired</Badge> : null}
          {detail.status === 'archived' ? <Badge tone="neutral">Archived</Badge> : null}
        </div>

        <h1 className="font-display text-ink mt-2 text-2xl leading-tight font-extrabold tracking-tight">
          {detail.title}
        </h1>

        <p className="text-muted mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
          {detail.authorName ? <span>{detail.authorName}</span> : null}
          {detail.publishedAt ? <span>Posted {dateLabel(detail.publishedAt)}</span> : null}
          {detail.expiresAt ? <span>Until {dateLabel(detail.expiresAt)}</span> : null}
          {detail.revisionNumber > 1 ? <span>Revision {detail.revisionNumber}</span> : null}
        </p>

        {/* A material revision is stated plainly: what changed, and that the
            earlier confirmation no longer covers it. */}
        {detail.needsReacknowledgement ? (
          <div className="rounded-card border-warning/40 bg-warning-soft mt-5 border p-4">
            <h2 className="font-display text-ink text-sm font-bold">
              This changed after you confirmed it
            </h2>
            <p className="text-ink mt-1.5 text-sm">
              You confirmed revision {detail.acknowledgedRevisionNumber ?? '—'}
              {detail.acknowledgedAt ? ` on ${dateLabel(detail.acknowledgedAt)}` : ''}. It has been
              revised since, so please read it again and confirm.
            </p>
            {detail.revisionNote ? (
              <p className="text-muted mt-2 text-sm">
                <span className="font-semibold">What changed:</span> {detail.revisionNote}
              </p>
            ) : null}
          </div>
        ) : detail.revisedSinceViewed ? (
          <p className="rounded-control border-info/30 bg-info-soft text-ink mt-5 border px-3.5 py-2.5 text-sm">
            This was updated after you last read it.
          </p>
        ) : null}

        <Card className="mt-5 p-5">
          <AnnouncementBody body={detail.body} />

          {detail.callToActionHref && isSafeHref(detail.callToActionHref) ? (
            <div className="mt-5">
              <ButtonLink href={detail.callToActionHref} variant="secondary">
                {detail.callToActionLabel ?? 'Open'}
              </ButtonLink>
            </div>
          ) : null}
        </Card>

        {detail.requiresAcknowledgement ? (
          <AcknowledgementPanel
            announcementId={detail.announcementId}
            needsAck={needsAck}
            overdue={overdue}
            dueLabel={detail.acknowledgementDueAt ? dateLabel(detail.acknowledgementDueAt) : null}
            recordedLabel={`Recorded${
              detail.acknowledgedAt ? ` on ${dateLabel(detail.acknowledgedAt)}` : ''
            }${
              detail.acknowledgedRevisionNumber
                ? `, against revision ${detail.acknowledgedRevisionNumber}`
                : ''
            }.`}
          />
        ) : null}
      </main>
    </div>
  )
}
