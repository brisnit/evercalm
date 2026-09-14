import type { Metadata } from 'next'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { loadLocations } from '@/modules/scheduling/access'
import { listMyTimeOff } from '@/modules/scheduling/requests'
import { localDateOf } from '@/modules/scheduling/time'
import { EmployeeShell, ScheduleTabs } from '../_components/employee-shell'
import { TimeOffPanel } from './time-off-panel'

export const metadata: Metadata = { title: 'Time off' }
export const dynamic = 'force-dynamic'

const REASONS: Record<string, string> = {
  vacation: 'Vacation',
  sick: 'Sick',
  personal: 'Personal',
  family: 'Family',
  other: 'Other',
}

/**
 * Ask for time off and see where each request stands. Approved time off stops
 * you being scheduled in that period; a pending request warns the manager
 * building the schedule.
 */
export default async function TimeOffPage() {
  const { actor } = await requireActorContext()
  const data = await withTenant(actor.organizationId, async (tx) => {
    const locations = await loadLocations(tx, actor.organizationId, actor.locationIds.slice(0, 1))
    const timeZone = locations.values().next().value?.timeZone ?? 'UTC'
    return { requests: await listMyTimeOff(tx, actor), today: localDateOf(new Date(), timeZone) }
  })

  return (
    <EmployeeShell>
      <h1 className="font-display text-ink text-2xl font-extrabold tracking-tight">Time off</h1>
      <p className="text-muted mt-1.5 text-sm">
        A manager decides each request and you are told either way. Your reason and note are seen
        only by the people who decide.
      </p>
      <ScheduleTabs current="time-off" />
      <TimeOffPanel
        today={data.today}
        requests={data.requests.map((r) => ({
          id: r.id,
          period: r.period,
          reason: REASONS[r.reason] ?? r.reason,
          note: r.note,
          status: r.status,
          decidedByName: r.decidedByName,
          decisionNote: r.decisionNote,
          cancellable:
            (r.status === 'pending' || r.status === 'approved') && r.endsOn >= data.today,
        }))}
      />
    </EmployeeShell>
  )
}
