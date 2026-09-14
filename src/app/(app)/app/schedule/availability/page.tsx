import type { Metadata } from 'next'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { canAtAnyLocation } from '@/server/authz/can'
import { addCalendarDays } from '@/lib/dates'
import { locationsWhere } from '@/modules/scheduling/access'
import { loadTeamAvailability } from '@/modules/scheduling/requests'
import {
  formatIsoDate,
  isIsoDate,
  isoWeekday,
  localDateOf,
  weekDates,
  weekStartOf,
} from '@/modules/scheduling/time'
import { Card, EmptyState, PageHeader, ScrollArea } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { WeekToolbar } from '../_components/week-toolbar'

export const metadata: Metadata = { title: 'Team availability' }
export const dynamic = 'force-dynamic'

const TONE: Record<string, string> = {
  time_off: 'bg-danger-soft text-danger',
  pending_time_off: 'bg-warning-soft text-warning',
  unavailable: 'bg-sunk text-ink',
  preferred: 'bg-success-soft text-success',
  none: 'text-faint',
}

/**
 * What people have said about a week, before it is built: approved and
 * requested time off, and declared availability. Read-only - availability is
 * each person's own statement, changed only by them.
 */
export default async function TeamAvailabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ location?: string; week?: string }>
}) {
  const params = await searchParams
  const { actor } = await requireActorContext()
  if (!canAtAnyLocation(actor, 'availability.view_team')) {
    return <PermissionDenied capabilityLabel="View team availability" />
  }

  const data = await withTenant(actor.organizationId, async (tx) => {
    const locations = await locationsWhere(tx, actor, 'availability.view_team')
    const location = locations.find((l) => l.id === params.location) ?? locations[0]
    if (!location) return null
    const thisWeek = weekStartOf(localDateOf(new Date(), location.timeZone))
    const weekStart =
      params.week && isIsoDate(params.week) && isoWeekday(params.week) === 1
        ? params.week
        : thisWeek
    return {
      locations,
      location,
      thisWeek,
      weekStart,
      rows: await loadTeamAvailability(tx, actor, location.id, weekStart),
    }
  })

  if (!data)
    return <EmptyState title="No locations" description="You do not manage any locations yet." />
  const dates = weekDates(data.weekStart)

  return (
    <>
      <PageHeader
        eyebrow={`Schedule · ${data.location.name}`}
        title="Team availability"
        description={`Week of ${formatIsoDate(data.weekStart)}. Only each person can change what they have said.`}
      />
      <WeekToolbar
        basePath="/app/schedule/availability"
        locations={data.locations.map((l) => ({ id: l.id, name: l.name }))}
        locationId={data.location.id}
        weekStart={data.weekStart}
        previousWeek={addCalendarDays(data.weekStart, -7)}
        nextWeek={addCalendarDays(data.weekStart, 7)}
        thisWeek={data.thisWeek}
      />

      <Card className="mt-5">
        {data.rows.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="Nobody works here yet"
              description="People assigned to this location appear here."
            />
          </div>
        ) : (
          <ScrollArea label="Team availability by day, scrollable horizontally">
            <table className="w-full min-w-[56rem] table-fixed text-sm">
              <caption className="sr-only">
                Availability and time off for each person, by day
              </caption>
              <thead>
                <tr className="border-line-strong bg-sunk border-b text-left">
                  <th
                    scope="col"
                    className="text-muted w-44 px-3 py-2.5 text-xs font-semibold tracking-wide uppercase"
                  >
                    Person
                  </th>
                  {dates.map((date) => (
                    <th
                      key={date}
                      scope="col"
                      className="text-muted px-2 py-2.5 text-xs font-semibold"
                    >
                      {formatIsoDate(date)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr
                    key={row.employmentId}
                    className="border-line border-b align-top last:border-b-0"
                  >
                    <th
                      scope="row"
                      className="text-ink px-3 py-2.5 text-left font-medium break-words"
                    >
                      {row.displayName}
                    </th>
                    {row.days.map((day) => (
                      <td key={day.date} className="px-1.5 py-2">
                        {day.labels.length === 0 ? (
                          <span className="text-faint text-xs">No limits</span>
                        ) : (
                          <ul className="flex flex-col gap-1">
                            {day.labels.map((label) => (
                              <li
                                key={label}
                                className={`rounded px-1.5 py-0.5 text-xs ${TONE[day.tone] ?? ''}`}
                              >
                                {label}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        )}
      </Card>
    </>
  )
}
