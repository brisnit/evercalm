import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { canAtAnyLocation } from '@/server/authz/can'
import { locationsWhere } from '@/modules/scheduling/access'
import { listJobRoles } from '@/modules/structure/service'
import { PageHeader } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { NoticeProvider } from '@/ui/patterns/notice-provider'
import { TemplateWizard } from './wizard'

export const metadata: Metadata = { title: 'New schedule template' }
export const dynamic = 'force-dynamic'

export default async function NewTemplatePage({
  searchParams,
}: {
  searchParams: Promise<{ location?: string }>
}) {
  const params = await searchParams
  const { actor } = await requireActorContext()
  if (!canAtAnyLocation(actor, 'schedule.manage_templates')) {
    return <PermissionDenied capabilityLabel="Manage schedule templates" />
  }

  const { location, roles } = await withTenant(actor.organizationId, async (tx) => {
    const locations = await locationsWhere(tx, actor, 'schedule.manage_templates')
    const location = locations.find((l) => l.id === params.location) ?? locations[0]
    return { location, roles: location ? await listJobRoles(tx, actor) : [] }
  })

  if (!location) notFound()

  return (
    <>
      <PageHeader
        back={{ href: '/app/schedule/templates', label: 'Templates' }}
        eyebrow={`${location.name} · guided setup`}
        title="What does your"
        accent="week look like?"
        description="Describe demand once. Nobody is assigned here — you choose people when you build a week."
      />
      <div className="py-7">
        <NoticeProvider>
          <TemplateWizard
            locationId={location.id}
            roles={roles.map((r) => ({ id: r.id, name: r.name }))}
          />
        </NoticeProvider>
      </div>
    </>
  )
}
