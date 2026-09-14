import type { Metadata } from 'next'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { can, canAtAnyLocation } from '@/server/authz/can'
import { locationsWhere } from '@/modules/scheduling/access'
import { listTemplates } from '@/modules/scheduling/service'
import { formatTimeOfDay } from '@/modules/scheduling/time'
import { listJobRoles, listStations } from '@/modules/structure/service'
import { EmptyState, PageHeader } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { TemplatesManager } from './templates-manager'

export const metadata: Metadata = { title: 'Shift templates' }
export const dynamic = 'force-dynamic'

/**
 * Reusable shift patterns per location. A template names what it is for in
 * the business's own words - "Bar close", "Colour bar" - and nothing in the
 * scheduling system depends on which words those are.
 */
export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ location?: string }>
}) {
  const params = await searchParams
  const { actor } = await requireActorContext()
  if (!canAtAnyLocation(actor, 'schedule.view_all')) {
    return <PermissionDenied capabilityLabel="View all schedules" />
  }

  const data = await withTenant(actor.organizationId, async (tx) => {
    const locations = await locationsWhere(tx, actor, 'schedule.view_all')
    const location = locations.find((l) => l.id === params.location) ?? locations[0]
    if (!location) return null
    return {
      locations,
      location,
      templates: await listTemplates(tx, actor, location.id),
      jobRoles: await listJobRoles(tx, actor),
      stations: (await listStations(tx, actor)).filter((s) => s.locationId === location.id),
      canManage: can(actor, 'schedule.manage_templates', { locationId: location.id }),
    }
  })

  if (!data) {
    return <EmptyState title="No locations" description="You do not manage any locations yet." />
  }

  return (
    <>
      <PageHeader
        eyebrow={`Schedule · ${data.location.name}`}
        title="Shift templates"
        description="Patterns you repeat. Applying them to a week adds unassigned shifts you then fill."
      />
      <TemplatesManager
        locations={data.locations.map((l) => ({ id: l.id, name: l.name }))}
        locationId={data.location.id}
        canManage={data.canManage}
        jobRoles={data.jobRoles.map((r) => ({ id: r.id, name: r.name }))}
        stations={data.stations.map((s) => ({ id: s.id, name: s.name }))}
        templates={data.templates.map((t) => ({
          id: t.id,
          name: t.name,
          jobRoleId: t.jobRoleId,
          jobRoleName: t.jobRoleName,
          stationId: t.stationId,
          stationName: t.stationName,
          startTime: formatTimeOfDay(t.startMinute),
          endTime: formatTimeOfDay(t.endMinute),
          breakMinutes: t.breakMinutes,
          daysOfWeek: t.daysOfWeek,
          headcount: t.headcount,
          notes: t.notes,
        }))}
      />
    </>
  )
}
