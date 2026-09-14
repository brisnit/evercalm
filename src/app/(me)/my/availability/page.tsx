import type { Metadata } from 'next'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { loadLocations } from '@/modules/scheduling/access'
import { getAvailability } from '@/modules/scheduling/requests'
import { formatIsoDate, formatTimeOfDay, localDateOf } from '@/modules/scheduling/time'
import { EmployeeShell, ScheduleTabs } from '../_components/employee-shell'
import { AvailabilityPanel } from './availability-panel'

export const metadata: Metadata = { title: 'Availability' }
export const dynamic = 'force-dynamic'

/**
 * When you can and cannot work. Managers see it while building the schedule
 * and are warned before putting you on a shift you said you cannot do - it is
 * your statement, so only you can change it.
 */
export default async function AvailabilityPage() {
  const { actor } = await requireActorContext()
  const data = await withTenant(actor.organizationId, async (tx) => {
    const locations = await loadLocations(tx, actor.organizationId, actor.locationIds.slice(0, 1))
    const timeZone = locations.values().next().value?.timeZone ?? 'UTC'
    const today = localDateOf(new Date(), timeZone)
    return {
      today,
      availability: await getAvailability(tx, actor, actor.employmentId, { fromDate: today }),
    }
  })

  const window = (start: number | null, end: number | null) =>
    start === null || end === null || (start === 0 && end === 1440)
      ? 'all day'
      : `${formatTimeOfDay(start)}–${end === 1440 ? '24:00' : formatTimeOfDay(end)}`

  return (
    <EmployeeShell>
      <h1 className="font-display text-ink text-2xl font-extrabold tracking-tight">Availability</h1>
      <p className="text-muted mt-1.5 text-sm">
        Tell your managers when you usually can’t work, or prefer to. It is a guide for them, not a
        booking: the schedule they publish is what you work.
      </p>
      <ScheduleTabs current="availability" />
      <AvailabilityPanel
        today={data.today}
        weekly={Array.from({ length: 7 }, (_, index) => {
          const weekday = index + 1
          const rule = data.availability.rules.find((r) => r.weekday === weekday)
          return {
            weekday,
            preference: rule?.preference ?? 'none',
            allDay: rule ? rule.startMinute === 0 && rule.endMinute === 1440 : true,
            // Midnight is a real time, not a missing one: 00:00 must round-trip.
            start: rule ? formatTimeOfDay(rule.startMinute) : '09:00',
            // An end of 24:00 is shown as 00:00, which saving reads back as the end of the day.
            end: rule
              ? rule.endMinute === 1440
                ? '00:00'
                : formatTimeOfDay(rule.endMinute)
              : '17:00',
            extraWindows: data.availability.rules.filter((r) => r.weekday === weekday).length - 1,
          }
        })}
        exceptions={data.availability.exceptions.map((e) => ({
          id: e.id,
          label: `${formatIsoDate(e.onDate)} · ${e.preference === 'unavailable' ? 'Unavailable' : 'Available'} ${window(e.startMinute, e.endMinute)}`,
          note: e.note,
        }))}
      />
    </EmployeeShell>
  )
}
