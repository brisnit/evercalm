import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { canAtAnyLocation } from '@/server/authz/can'
import { weekReview } from '@/modules/scheduling/slotted'
import { reviewDayAction } from '@/modules/scheduling/slotted-actions'
import { NotFoundError } from '@/lib/errors'
import { formatIsoDate } from '@/modules/scheduling/time'
import { Button, Card, CardHeader, PageHeader } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { AvailabilityPill } from '@/ui/patterns/availability-pill'
import { AVAILABILITY_EXPLANATIONS } from '@/modules/scheduling/availability-state'

export const metadata: Metadata = { title: 'The full day' }
export const dynamic = 'force-dynamic'

/**
 * The zoomed-in day: every person, break, note and warning, each one tappable.
 *
 * This is the edit mode the review stack opens into. A warning here is written
 * in plain language and offers a choice rather than stopping the manager —
 * except approved time off, which cannot appear at all, because the service
 * refuses to create it.
 */
export default async function DayPage({
  params,
}: {
  params: Promise<{ scheduleId: string; date: string }>
}) {
  const { scheduleId, date } = await params
  const { actor } = await requireActorContext()
  if (!canAtAnyLocation(actor, 'schedule.draft')) {
    return <PermissionDenied capabilityLabel="Build schedules" />
  }

  const review = await withTenant(actor.organizationId, async (tx) => {
    try {
      return await weekReview(tx, actor, scheduleId)
    } catch (error) {
      if (error instanceof NotFoundError) return null
      throw error
    }
  })
  const day = review?.days.find((d) => d.date === date)
  if (!review || !day) notFound()

  const morning = day.shifts.filter((s) => s.time.includes('AM'))
  const rest = day.shifts.filter((s) => !s.time.includes('AM'))

  return (
    <>
      <PageHeader
        back={{ href: `/app/schedule/review/${scheduleId}`, label: 'Review' }}
        eyebrow={review.locationName}
        title={formatIsoDate(date)}
        description={`${day.filled} of ${day.slots} slots filled · ${Math.round(day.staffMinutes / 60)} staff hours · ${day.breaks} breaks placed`}
      />

      <div className="flex flex-col gap-5 py-7">
        {day.issues.length > 0 ? (
          <Card className="border-warning/30">
            <CardHeader
              title={`${day.issues.length} to look at`}
              description="Warnings, not blocks. Approved time off never reaches this list — it cannot be scheduled over at all."
            />
            <ul className="divide-line divide-y">
              {day.issues.map((issue, index) => (
                <li key={index} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <span className="text-ink text-sm">{issue.message}</span>
                  {issue.shiftId ? (
                    <Link
                      href={`/app/schedule/slots/${issue.shiftId}`}
                      className="text-action ms-auto text-sm font-semibold underline-offset-4 hover:underline"
                    >
                      Change who works it
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {[
          { title: 'Day shifts', shifts: morning },
          { title: 'Later shifts', shifts: rest },
        ]
          .filter((group) => group.shifts.length > 0)
          .map((group) => (
            <Card key={group.title}>
              <CardHeader title={`${group.title} · ${group.shifts.length}`} />
              <ul className="divide-line divide-y">
                {group.shifts.map((shift) => (
                  <li key={shift.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-faint text-xs font-semibold tracking-wide uppercase">
                          {shift.roleName ?? 'Any role'} · {shift.time}
                        </p>
                        <p className="mt-1 flex flex-wrap items-center gap-2">
                          <span className="text-ink font-medium">
                            {shift.assigneeName ?? 'Empty slot'}
                          </span>
                          {shift.state ? <AvailabilityPill state={shift.state} /> : null}
                        </p>
                        {shift.breakMinutes > 0 ? (
                          <p className="text-muted mt-1 text-sm">
                            Break {shift.breakMinutes} min · placed by your template’s rules
                          </p>
                        ) : null}
                        {shift.note ? (
                          <p className="text-muted mt-1 text-sm italic">{shift.note}</p>
                        ) : null}
                        {shift.state === 'unavailable' || shift.state === 'not_preferred' ? (
                          <p className="text-warning mt-2 text-sm">
                            {AVAILABILITY_EXPLANATIONS[shift.state]}
                            {shift.overridden ? ' You chose to schedule them anyway.' : ''}
                          </p>
                        ) : null}
                      </div>
                      <Link
                        href={`/app/schedule/slots/${shift.id}`}
                        className="rounded-control border-line text-ink hover:bg-sunk inline-flex min-h-11 items-center border bg-white px-4 text-sm font-medium"
                      >
                        {shift.assigneeName ? 'Change' : 'Fill it'}
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          ))}

        <div className="flex flex-wrap gap-2">
          <form action={reviewDayAction}>
            <input type="hidden" name="scheduleId" value={scheduleId} />
            <input type="hidden" name="onDate" value={date} />
            <input type="hidden" name="state" value="approved" />
            <Button type="submit" size="lg">
              Approve {formatIsoDate(date)}
            </Button>
          </form>
          <form action={reviewDayAction}>
            <input type="hidden" name="scheduleId" value={scheduleId} />
            <input type="hidden" name="onDate" value={date} />
            <input type="hidden" name="state" value="flagged" />
            <Button type="submit" variant="secondary" size="lg">
              Flag it for later
            </Button>
          </form>
        </div>
      </div>
    </>
  )
}
