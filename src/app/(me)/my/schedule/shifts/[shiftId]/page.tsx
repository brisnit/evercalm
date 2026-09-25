import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { NotFoundError } from '@/lib/errors'
import { isUuid } from '@/lib/uuid'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { getMyShift } from '@/modules/scheduling/employee'
import { getEmployment } from '@/modules/people/service'
import { Card } from '@/ui/primitives'
import { EmployeeShell } from '../../../_components/employee-shell'
import { OverrideNotice } from '@/ui/patterns/override-notice'
import { SwapPanel } from './swap-panel'

export const metadata: Metadata = { title: 'Shift' }
export const dynamic = 'force-dynamic'

/**
 * One of your published shifts, and the one thing you can do about it:
 * ask a named colleague to take it or trade for one of theirs.
 * Anyone else's shift is simply not found.
 */
export default async function MyShiftPage({ params }: { params: Promise<{ shiftId: string }> }) {
  const { shiftId } = await params
  if (!isUuid(shiftId)) notFound()
  const { actor } = await requireActorContext()

  const data = await withTenant(actor.organizationId, async (tx) => ({
    detail: await getMyShift(tx, actor, shiftId),
    me: await getEmployment(tx, actor, actor.employmentId).catch(() => null),
  })).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound()
    throw error
  })
  const { detail, me } = data
  const { shift } = detail

  return (
    <EmployeeShell back={{ href: '/my/schedule', label: 'Your schedule' }}>
      <p className="text-faint text-xs font-semibold tracking-[0.08em] uppercase">
        {shift.locationName}
      </p>
      <h1 className="font-display text-ink text-[1.625rem] leading-tight font-extrabold tracking-tight">
        {shift.day}
      </h1>
      <p className="text-ink mt-1 text-lg font-semibold tabular-nums">
        {shift.time}
        {shift.endsNextDay ? ' (ends the next day)' : ''}
      </p>

      <Card className="mt-5 p-5">
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-muted text-xs">Role</dt>
            <dd className="text-ink font-medium">{shift.jobRoleName ?? 'Any'}</dd>
          </div>
          <div>
            <dt className="text-muted text-xs">Station</dt>
            <dd className="text-ink font-medium">{shift.stationName ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-muted text-xs">Paid time</dt>
            <dd className="text-ink font-medium">{shift.duration}</dd>
          </div>
          <div>
            <dt className="text-muted text-xs">Break</dt>
            <dd className="text-ink font-medium">
              {shift.breakMinutes > 0 ? `${shift.breakMinutes} minutes` : 'None'}
            </dd>
          </div>
        </dl>
        {shift.notes ? (
          <p className="text-ink border-line mt-4 border-t pt-4 text-sm">{shift.notes}</p>
        ) : null}
      </Card>

      {shift.override ? (
        <div className="mt-5">
          <OverrideNotice
            override={shift.override}
            managerEmploymentId={me?.managerEmploymentId ?? null}
            managerName={me?.managerName ?? null}
          />
        </div>
      ) : null}

      <SwapPanel
        shiftId={shift.id}
        started={detail.started}
        swap={shift.swap}
        colleagues={detail.colleagues}
      />
    </EmployeeShell>
  )
}
