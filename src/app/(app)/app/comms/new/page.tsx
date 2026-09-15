import type { Metadata } from 'next'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { canAtAnyLocation } from '@/server/authz/can'
import { listCategories, organizationTimeZone } from '@/modules/comms/service'
import { publishingScope } from '@/modules/comms/audience'
import { selectableEvents } from '@/modules/events/service'
import { BackLink, PageHeader } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { Composer } from '../composer'
import { audienceOptions } from '../audience-options'

export const metadata: Metadata = { title: 'New announcement' }
export const dynamic = 'force-dynamic'

export default async function NewAnnouncementPage() {
  const { actor } = await requireActorContext()

  if (!canAtAnyLocation(actor, 'announcement.create')) {
    return <PermissionDenied capabilityLabel="Create announcements" />
  }

  const scope = publishingScope(actor)
  const data = await withTenant(actor.organizationId, async (tx) => ({
    categories: await listCategories(tx, actor.organizationId),
    options: await audienceOptions(tx, actor),
    events: await selectableEvents(tx, actor),
    timeZone: await organizationTimeZone(tx, actor.organizationId),
  }))

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3">
        <BackLink href="/app/comms">Announcements</BackLink>
      </nav>

      <PageHeader
        title="New announcement"
        description="Write it, choose who sees it, then check the audience before anything goes out."
      />

      <div className="mt-6">
        <Composer
          mode="create"
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
        />
      </div>
    </>
  )
}
