import type { Metadata } from 'next'
import Link from 'next/link'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { getMySchedule } from '@/modules/scheduling/employee'
import { formatIsoDate, isIsoDate, isoWeekday } from '@/modules/scheduling/time'
import { Badge, Card, EmptyState, TextLink } from '@/ui/primitives'
import { EmployeeShell, EmployeeTitle, ScheduleTabs } from '../_components/employee-shell'

import { IncomingSwaps, OpenShiftsAndRequests } from './schedule-requests'

export const metadata: Metadata = { title: 'Your schedule' }
export const dynamic = 'force-dynamic'

/**
 * The employee schedule, phone first.
 *
 * What needs you first (a colleague asking you to take their shift), then your
 * shifts by day, then open shifts you could pick up and where your own
 * requests stand. Only published shifts appear: nobody plans around a draft.
 */
export default async function MySchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>
}) {
  const params = await searchParams
  const { actor } = await requireActorContext()
  const weekStart =
    params.week && isIsoDate(params.week) && isoWeekday(params.week) === 1 ? params.week : undefined
  const schedule = await withTenant(actor.organizationId, (tx) =>
    getMySchedule(tx, actor, { weekStart }),
  )

  const days = new Map<string, typeof schedule.upcoming>()
  for (const shift of schedule.upcoming) {
    days.set(shift.localDate, [...(days.get(shift.localDate) ?? []), shift])
  }
  const incoming = schedule.swaps.filter(
    (s) => s.direction === 'incoming' && s.status === 'pending_recipient',
  )

  return (
    <EmployeeShell>
      <EmployeeTitle
        title="Your"
        accent="schedule"
        description={`${weekStart ? `Week of ${formatIsoDate(weekStart)}.` : 'The next four weeks.'} Times are shown where you work.`}
      />
      <ScheduleTabs current="schedule" />

      <div className="mt-6 flex flex-col gap-6">
        <IncomingSwaps swaps={incoming} />

        <section aria-labelledby="shifts-heading">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="shifts-heading" className="font-display text-ink text-lg font-bold">
              Shifts
            </h2>
            {weekStart ? (
              <TextLink href="/my/schedule" className="text-sm">
                Show upcoming
              </TextLink>
            ) : null}
          </div>
          {schedule.upcoming.length === 0 ? (
            <div className="mt-3">
              <EmptyState
                title="No shifts published for you"
                description="Your manager publishes the schedule, and you are notified when your shifts are ready or change."
              />
            </div>
          ) : (
            <ol className="mt-3 flex flex-col gap-4">
              {[...days.entries()].map(([date, shifts]) => (
                <li key={date}>
                  <h3 className="text-ink text-sm font-semibold">{formatIsoDate(date)}</h3>
                  <ul className="mt-2 flex flex-col gap-2">
                    {shifts.map((shift) => (
                      <li key={shift.id}>
                        <Link href={`/my/schedule/shifts/${shift.id}`} className="block">
                          <Card className="hover:border-line-strong p-4">
                            <span className="text-ink block text-base font-semibold tabular-nums">
                              {shift.time}
                              {shift.endsNextDay ? ' (next day)' : ''}
                            </span>
                            <span className="text-muted block text-sm">
                              {[shift.jobRoleName, shift.stationName].filter(Boolean).join(' · ') ||
                                'Shift'}{' '}
                              · {shift.locationName}
                            </span>
                            <span className="text-faint mt-1 block text-xs">
                              {shift.duration} paid
                              {shift.breakMinutes > 0 ? ` · ${shift.breakMinutes} min break` : ''}
                            </span>
                            {shift.notes ? (
                              <span className="text-ink mt-2 block text-sm">{shift.notes}</span>
                            ) : null}
                            {shift.override ? (
                              <span className="mt-2 block">
                                <Badge tone="warning">
                                  {shift.override.kind === 'unavailable'
                                    ? 'Scheduled against your availability'
                                    : 'Not a shift you prefer'}
                                </Badge>
                              </span>
                            ) : null}
                            {shift.swap ? (
                              <span className="mt-2 block">
                                <Badge tone="accent">
                                  {shift.swap.status === 'pending_manager'
                                    ? 'Swap waiting for a manager'
                                    : 'Swap requested'}
                                </Badge>
                              </span>
                            ) : null}
                          </Card>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </section>

        <OpenShiftsAndRequests
          openShifts={schedule.openShifts}
          swaps={schedule.swaps.filter(
            (s) => !(s.direction === 'incoming' && s.status === 'pending_recipient'),
          )}
          claims={schedule.claims}
          timeOff={schedule.timeOff}
        />
      </div>
    </EmployeeShell>
  )
}
