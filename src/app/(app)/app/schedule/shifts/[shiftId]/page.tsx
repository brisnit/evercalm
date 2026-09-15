import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ForbiddenError, NotFoundError } from '@/lib/errors'
import { isUuid } from '@/lib/uuid'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { loadShiftForManager } from '@/modules/scheduling/manager'
import { formatDuration, formatIsoDate, weekDates } from '@/modules/scheduling/time'
import { listJobRoles, listStations } from '@/modules/structure/service'
import { BackLink, Badge, PageHeader } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { ShiftManager } from './shift-manager'

export const metadata: Metadata = { title: 'Shift' }
export const dynamic = 'force-dynamic'

/**
 * One shift, from the manager's side: change it, put someone on it with every
 * reason they cannot or should not stated up front, offer it, or remove it.
 */
export default async function ShiftPage({ params }: { params: Promise<{ shiftId: string }> }) {
  const { shiftId } = await params
  if (!isUuid(shiftId)) notFound()
  const { actor } = await requireActorContext()

  const data = await withTenant(actor.organizationId, async (tx) => {
    const shift = await loadShiftForManager(tx, actor, shiftId)
    return {
      shift,
      jobRoles: await listJobRoles(tx, actor),
      stations: (await listStations(tx, actor)).filter((s) => s.locationId === shift.location.id),
    }
  }).catch((error: unknown) => {
    // Another location's or tenant's shift, and one that never existed, are the same answer.
    if (error instanceof NotFoundError) notFound()
    if (error instanceof ForbiddenError) return null
    throw error
  })

  if (!data) return <PermissionDenied capabilityLabel="View all schedules" />
  const { shift } = data
  const weekHref = `/app/schedule?location=${shift.location.id}&week=${shift.weekStart}`

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3">
        <BackLink href={weekHref}>
          {shift.location.name}, week of {formatIsoDate(shift.weekStart)}
        </BackLink>
      </nav>

      <PageHeader
        eyebrow={[shift.jobRoleName, shift.stationName].filter(Boolean).join(' · ') || 'Shift'}
        title={`${shift.day} · ${shift.time}${shift.endsNextDay ? ' (next day)' : ''}`}
        description={`${formatDuration(shift.paidMinutes)} paid${shift.breakMinutes > 0 ? `, ${shift.breakMinutes} minute break` : ''}. ${shift.location.name} time.`}
      />

      <div className="-mt-3 mb-6 flex flex-wrap gap-2">
        {shift.status === 'cancelled' ? <Badge tone="neutral">Cancelled</Badge> : null}
        {shift.published ? (
          <Badge tone="success">Published</Badge>
        ) : (
          <Badge tone="warning">Not yet published</Badge>
        )}
        {shift.unpublishedChange ? <Badge tone="info">Changed since publishing</Badge> : null}
        {shift.isOpen ? <Badge tone="violet">Open shift</Badge> : null}
        {shift.conflicts.some((c) => c.severity === 'block') ? (
          <Badge tone="danger">Conflict</Badge>
        ) : null}
      </div>

      <ShiftManager
        shift={shift}
        days={weekDates(shift.weekStart).map((date) => ({ date, label: formatIsoDate(date) }))}
        jobRoles={data.jobRoles.map((r) => ({ id: r.id, name: r.name }))}
        stations={data.stations.map((s) => ({ id: s.id, name: s.name }))}
        weekHref={weekHref}
      />
    </>
  )
}
