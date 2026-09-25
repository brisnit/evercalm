import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { NotFoundError } from '@/lib/errors'
import { isUuid } from '@/lib/uuid'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { canAtAnyLocation } from '@/server/authz/can'
import {
  listCategories,
  loadAudienceRules,
  organizationTimeZone,
  requireAnnouncement,
} from '@/modules/comms/service'
import { instantToZonedWallTime } from '@/lib/dates'
import { publishingScope, resolveSelectorLabels } from '@/modules/comms/audience'
import { selectableEvents } from '@/modules/events/service'
import { PageHeader } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { Composer, type DraftRule } from '../../composer'
import { audienceOptions } from '../../audience-options'

export const metadata: Metadata = { title: 'Edit announcement' }
export const dynamic = 'force-dynamic'

/** Editing is only ever a draft or a scheduled announcement. */
export default async function EditAnnouncementPage({
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
    return {
      announcement,
      rules,
      labels,
      categories: await listCategories(tx, actor.organizationId),
      options: await audienceOptions(tx, actor),
      events: await selectableEvents(tx, actor),
      timeZone: await organizationTimeZone(tx, actor.organizationId),
    }
  }).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound()
    throw error
  })

  // Published wording is corrected through a revision, never edited here.
  if (data.announcement.status !== 'draft' && data.announcement.status !== 'scheduled') {
    redirect(`/app/comms/${announcementId}`)
  }

  const scope = publishingScope(actor)
  const draftRules: DraftRule[] = data.rules.map((rule, index) => ({
    mode: rule.mode,
    selectorType: rule.selectorType,
    selectorId: rule.selectorId,
    label: data.labels[index]?.label ?? 'Unknown group',
  }))

  return (
    <>
      <PageHeader
        back={{ href: `/app/comms/${announcementId}`, label: data.announcement.title }}
        title="Edit announcement"
        description="Nobody has received this yet, so changes here replace the draft outright."
      />

      <div className="mt-6">
        <Composer
          mode="edit"
          timeZone={data.timeZone}
          categories={data.categories}
          options={data.options}
          events={data.events.map((e) => ({
            id: e.id,
            title: e.title,
            startsAt: e.startsAt.toISOString().slice(0, 10),
          }))}
          permissions={{
            organizationWide: scope.organizationWide,
            mayUseUrgent: canAtAnyLocation(actor, 'announcement.publish_urgent'),
            mayUseEmergency: canAtAnyLocation(actor, 'announcement.publish_emergency'),
          }}
          initial={{
            announcementId,
            title: data.announcement.title,
            body: data.announcement.body,
            categoryId: data.announcement.categoryId,
            priority: data.announcement.priority,
            requiresAcknowledgement: data.announcement.requiresAcknowledgement,
            acknowledgementDueAt: toLocalInput(
              data.announcement.acknowledgementDueAt,
              data.timeZone,
            ),
            expiresAt: toLocalInput(data.announcement.expiresAt, data.timeZone),
            callToActionLabel: data.announcement.callToActionLabel ?? '',
            callToActionHref: data.announcement.callToActionHref ?? '',
            eventId: data.announcement.eventId ?? '',
            rules: draftRules,
          }}
        />
      </div>
    </>
  )
}

/**
 * `datetime-local` wants `YYYY-MM-DDTHH:mm` with no zone - so it is the
 * wall-clock time in the organization's timezone, the same zone the form is
 * read back in. (It used to be the UTC time, which shifted on every save.)
 */
function toLocalInput(value: Date | null, timeZone: string): string {
  return value ? instantToZonedWallTime(value, timeZone) : ''
}
