import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { NotFoundError } from '@/lib/errors'
import { isUuid } from '@/lib/uuid'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { canAtAnyLocation } from '@/server/authz/can'
import {
  listRevisions,
  loadAudienceRules,
  organizationTimeZone,
  previewAudience,
  requireAnnouncement,
} from '@/modules/comms/service'
import { receiptReport } from '@/modules/comms/receipts'
import { resolveSelectorLabels } from '@/modules/comms/audience'
import { formatDateInZone, formatInZone } from '@/lib/dates'
import { ButtonLink, Card, CardHeader, PageHeader } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { AnnouncementBody } from '@/ui/patterns/announcement-body'
import { PriorityMark, StatusMark } from '@/ui/patterns/priority-mark'
import { LifecycleActions } from './lifecycle-actions'
import { ReceiptsPanel } from './receipts-panel'

export const metadata: Metadata = { title: 'Announcement' }
export const dynamic = 'force-dynamic'

/**
 * One announcement, from the author's side.
 *
 * Three questions, in this order: what does it say, who gets it, and what has
 * happened since. Before publication the middle one is a preview with a real
 * count; after publication it is the receipt report.
 */
export default async function AnnouncementDetailPage({
  params,
}: {
  params: Promise<{ announcementId: string }>
}) {
  const { announcementId } = await params
  if (!isUuid(announcementId)) notFound()
  const { actor } = await requireActorContext()

  if (!canAtAnyLocation(actor, 'announcement.create')) {
    return <PermissionDenied capabilityLabel="Create announcements" />
  }

  const data = await withTenant(actor.organizationId, async (tx) => {
    const announcement = await requireAnnouncement(tx, actor, announcementId)
    const rules = await loadAudienceRules(tx, actor.organizationId, announcementId)
    const labels = await resolveSelectorLabels(tx, actor.organizationId, rules)
    const revisions = await listRevisions(tx, actor, announcementId)

    // The preview needs the author's own scope, so it is only run for someone
    // who could publish. A viewer without it still sees the audience summary.
    const preview = canAtAnyLocation(actor, 'announcement.create')
      ? await previewAudience(tx, actor, rules).catch(() => null)
      : null

    const receipts =
      announcement.status === 'published' ||
      announcement.status === 'expired' ||
      announcement.status === 'archived'
        ? canAtAnyLocation(actor, 'announcement.view_receipts')
          ? await receiptReport(tx, actor, announcementId).catch(() => null)
          : null
        : null

    const timeZone = await organizationTimeZone(tx, actor.organizationId)

    return { announcement, rules, labels, revisions, preview, receipts, timeZone }
  }).catch((error: unknown) => {
    // Another tenant's announcement and one that never existed are the same
    // answer, and neither is a server fault.
    if (error instanceof NotFoundError) notFound()
    throw error
  })

  const { announcement } = data
  const editable = announcement.status === 'draft' || announcement.status === 'scheduled'

  return (
    <>
      <PageHeader
        back={{ href: '/app/comms', label: 'Announcements' }}
        eyebrow={announcement.categoryName}
        title={announcement.title}
        action={
          editable ? (
            <ButtonLink href={`/app/comms/${announcementId}/edit`} variant="secondary">
              Edit
            </ButtonLink>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusMark status={announcement.status} />
        <PriorityMark priority={announcement.priority} />
        {announcement.requiresAcknowledgement ? (
          <span className="bg-sunk text-muted rounded-full px-2.5 py-1 text-[0.6875rem] font-semibold">
            Needs confirmation
          </span>
        ) : null}
        <span className="text-muted text-xs">
          {announcement.authorName ? `${announcement.authorName} · ` : ''}
          {announcement.publishedAt
            ? `posted ${formatDateInZone(announcement.publishedAt, data.timeZone)}`
            : `created ${formatDateInZone(announcement.createdAt, data.timeZone)}`}
          {announcement.revisionNumber > 1 ? ` · revision ${announcement.revisionNumber}` : ''}
        </span>
      </div>

      {/* The worker could not publish a schedule. Said on the page, not only in
          the audit log, because the author is the one who has to act. */}
      {announcement.status === 'draft' && announcement.publishFailureReason ? (
        <div className="rounded-card border-warning/40 bg-warning-soft mt-5 border p-4">
          <h2 className="font-display text-ink text-sm font-bold">
            This did not go out as scheduled
          </h2>
          <p className="text-ink mt-1.5 text-sm">
            {announcement.publishFailureReason} It was returned to a draft
            {announcement.publishFailedAt
              ? ` at ${formatInZone(announcement.publishFailedAt, data.timeZone)}`
              : ''}
            , and nobody received it.
          </p>
          <p className="text-muted mt-1.5 text-sm">
            Check who it is for, then publish or schedule it again.
          </p>
        </div>
      ) : null}

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start [&>*]:min-w-0">
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="What it says" />
            <div className="p-5">
              <AnnouncementBody body={announcement.body} />
              {announcement.callToActionLabel ? (
                <p className="text-muted mt-4 text-sm">
                  Button:{' '}
                  <span className="text-ink font-medium">{announcement.callToActionLabel}</span>
                  {announcement.callToActionHref ? ` → ${announcement.callToActionHref}` : ''}
                </p>
              ) : null}
            </div>
          </Card>

          {data.revisions.length > 1 ? (
            <Card>
              <CardHeader
                title="Revision history"
                description="Every correction is kept. An acknowledgement records the revision it was made against."
              />
              <ul className="p-5 pt-0">
                {data.revisions.map((revision) => (
                  <li
                    key={revision.id}
                    className="border-line/60 flex flex-wrap items-center gap-x-3 gap-y-1 border-b py-3 last:border-b-0 last:pb-0"
                  >
                    <span className="text-ink text-sm font-semibold">
                      Revision {revision.revisionNumber}
                    </span>
                    {revision.isMaterial ? (
                      <span className="bg-warning-soft text-warning rounded-full px-2.5 py-0.5 text-[0.6875rem] font-semibold">
                        Material — re-confirmation asked
                      </span>
                    ) : null}
                    <span className="text-muted text-xs">
                      {revision.authorName ? `${revision.authorName} · ` : ''}
                      {formatDateInZone(revision.createdAt, data.timeZone)}
                    </span>
                    {revision.note ? (
                      <span className="text-muted w-full text-xs">{revision.note}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Who sees it" />
            <div className="p-5">
              <p className="text-ink text-sm font-medium">
                {data.preview?.summary ??
                  (data.labels.length > 0
                    ? data.labels.map((l) => l.label).join(', ')
                    : 'Nobody yet.')}
              </p>
              {data.preview ? (
                <p className="text-muted mt-2 text-sm">
                  <span className="text-ink font-semibold">{data.preview.count}</span>{' '}
                  {data.preview.count === 1 ? 'person matches' : 'people match'} this right now
                  {data.preview.sample.length > 0
                    ? `, including ${data.preview.sample.slice(0, 3).join(', ')}`
                    : ''}
                  .
                </p>
              ) : null}
              {announcement.status === 'published' ? (
                <p className="text-faint mt-2 text-xs">
                  Recipients were fixed when it was published, so this count can differ from the
                  report if people have joined or left since.
                </p>
              ) : null}
            </div>
          </Card>

          <LifecycleActions
            announcementId={announcementId}
            status={announcement.status}
            priority={announcement.priority}
            title={announcement.title}
            body={announcement.body}
            callToActionLabel={announcement.callToActionLabel ?? ''}
            callToActionHref={announcement.callToActionHref ?? ''}
            audienceSummary={data.preview?.summary ?? ''}
            audienceCount={data.preview?.count ?? 0}
            requiresAcknowledgement={announcement.requiresAcknowledgement}
            timeZone={data.timeZone}
            scheduledLabel={
              announcement.status === 'scheduled' && announcement.publishAt
                ? formatInZone(announcement.publishAt, data.timeZone)
                : null
            }
            permissions={{
              mayPublish: canAtAnyLocation(actor, 'announcement.publish'),
              mayArchive: canAtAnyLocation(actor, 'announcement.archive'),
              mayEmergency: canAtAnyLocation(actor, 'announcement.publish_emergency'),
            }}
          />
        </div>
      </div>

      {/*
        Full width: the report is a table plus three breakdowns, and it was
        being squeezed into a column while the page had room to spare.
      */}
      <div className="mt-5">
        {data.receipts ? (
          <ReceiptsPanel
            announcementId={announcementId}
            report={{
              totals: data.receipts.totals,
              partialView: data.receipts.partialView,
              requiresAcknowledgement: data.receipts.requiresAcknowledgement,
              acknowledgementDueAt: data.receipts.acknowledgementDueAt
                ? formatInZone(data.receipts.acknowledgementDueAt, data.timeZone)
                : null,
              byLocation: data.receipts.byLocation,
              byDepartment: data.receipts.byDepartment,
              byJobRole: data.receipts.byJobRole,
              rows: data.receipts.rows.map((r) => ({
                employmentId: r.employmentId,
                displayName: r.displayName,
                locationName: r.locationName,
                jobRoleName: r.jobRoleName,
                deliveryStatus: r.deliveryStatus,
                deliveryFailureReason: r.deliveryFailureReason,
                viewed: r.firstViewedAt !== null,
                acknowledged: r.acknowledgedAt !== null && !r.needsReacknowledgement,
                needsReacknowledgement: r.needsReacknowledgement,
                reminderCount: r.reminderCount,
              })),
            }}
            mayRemind={canAtAnyLocation(actor, 'announcement.send_reminder')}
          />
        ) : announcement.status === 'published' ? (
          <Card>
            <CardHeader title="Who has read it" />
            <p className="text-muted p-5 text-sm">
              You do not have permission to see read and acknowledgement receipts.
            </p>
          </Card>
        ) : null}
      </div>
    </>
  )
}
