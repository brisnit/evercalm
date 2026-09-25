import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { canAtAnyLocation } from '@/server/authz/can'
import { locationsWhere } from '@/modules/scheduling/access'
import { listTemplateSets, weekReview, type WeekReview } from '@/modules/scheduling/slotted'
import { listOpenCallouts } from '@/modules/scheduling/slotted'
import { schedules } from '@/server/db/schema'
import { and, eq } from 'drizzle-orm'
import { addCalendarDays } from '@/lib/dates'
import { formatIsoDate, isIsoDate, weekStartOf } from '@/modules/scheduling/time'
import { Card, CardHeader, EmptyState, PageHeader } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { AvailabilityLegend } from '@/ui/patterns/availability-pill'
import { LocationPicker } from './_components/location-picker'
import { WeekNav } from './_components/week-nav'
import { StartWeek } from './_components/start-week'
import { WeekActions } from './_components/week-actions'
import { DayStack } from './_components/day-stack'

export const metadata: Metadata = { title: 'Schedule' }
export const dynamic = 'force-dynamic'

/**
 * The week.
 *
 * Slotted's two densities from one set of data: on a wide screen the whole
 * week at once, a row per shift pattern, so a manager can see the shape of it;
 * on a phone the days stack and one opens at a time, because a shrunken
 * spreadsheet is unusable in a doorway.
 *
 * Every filled cell carries what the person said about those hours, in a word
 * and a mark, so a problem is visible before anybody clicks anything.
 */
export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ location?: string; week?: string; template?: string; generated?: string }>
}) {
  const params = await searchParams
  const { actor } = await requireActorContext()

  if (!canAtAnyLocation(actor, 'schedule.view_all')) {
    const decides = (['timeoff.decide', 'swap.decide', 'openshift.manage'] as const).some((c) =>
      canAtAnyLocation(actor, c),
    )
    if (decides) redirect('/app/schedule/requests')
    return <PermissionDenied capabilityLabel="View all schedules" />
  }

  const weekStart =
    params.week && isIsoDate(params.week)
      ? weekStartOf(params.week)
      : weekStartOf(new Date().toISOString().slice(0, 10))

  const data = await withTenant(actor.organizationId, async (tx) => {
    const locations = await locationsWhere(tx, actor, 'schedule.view_all')
    // Default to a site this person actually works at, not the first one
    // alphabetically - a GM at Riverside should not open on Downtown.
    const location =
      locations.find((l) => l.id === params.location) ??
      locations.find((l) => actor.locationIds.includes(l.id)) ??
      locations[0]
    if (!location) return { locations, location: null, review: null, sets: [], callouts: [] }

    const [schedule] = await tx
      .select({ id: schedules.id })
      .from(schedules)
      .where(
        and(
          eq(schedules.organizationId, actor.organizationId),
          eq(schedules.locationId, location.id),
          eq(schedules.weekStart, weekStart),
        ),
      )
      .limit(1)

    return {
      locations,
      location,
      review: schedule ? await weekReview(tx, actor, schedule.id) : null,
      sets: await listTemplateSets(tx, actor, location.id),
      callouts: (await listOpenCallouts(tx, actor, location.id)).filter((c) => !c.resolvedAt),
    }
  })

  if (!data.location) {
    return (
      <>
        <PageHeader title="Schedule" />
        <div className="py-7">
          <EmptyState
            title="No locations yet"
            description="Add a location in Settings, then build a schedule template for it."
          />
        </div>
      </>
    )
  }

  const { location, locations, review, sets, callouts } = data
  const canDraft = canAtAnyLocation(actor, 'schedule.draft')

  return (
    <>
      <PageHeader
        eyebrow={location.name}
        title="Week of"
        accent={formatIsoDate(weekStart)}
        description={
          review
            ? `${review.filled} of ${review.slots} slots filled · ${review.status === 'published' ? 'published' : 'draft, not published'}`
            : 'Nothing here yet. Start the week from a template and the slots lay themselves out.'
        }
        action={
          review && canDraft ? (
            <WeekActions
              scheduleId={review.scheduleId}
              filled={review.filled}
              slots={review.slots}
              status={review.status}
            />
          ) : undefined
        }
      />

      <div className="flex flex-col gap-6 py-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          {locations.length > 1 ? (
            <LocationPicker
              locations={locations}
              current={location.id}
              basePath="/app/schedule"
              extra={{ week: weekStart }}
            />
          ) : (
            <span />
          )}
          <WeekNav
            locationId={location.id}
            previous={addCalendarDays(weekStart, -7)}
            next={addCalendarDays(weekStart, 7)}
            current={formatIsoDate(weekStart)}
          />
        </div>

        {callouts.length > 0 ? (
          <Card className="border-danger/30">
            <CardHeader
              title={`${callouts.length} ${callouts.length === 1 ? 'person has' : 'people have'} called out`}
              description="Pick a replacement from people who are qualified and free."
            />
            <ul className="divide-line divide-y">
              {callouts.map((callout) => (
                <li key={callout.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <span className="text-ink font-medium">{callout.displayName}</span>
                  <span className="text-muted text-sm">
                    {callout.roleName ? `${callout.roleName} · ` : ''}
                    {callout.when}
                  </span>
                  <Link
                    href={`/app/schedule/callouts/${callout.shiftId}`}
                    className="text-action ms-auto text-sm font-semibold underline-offset-4 hover:underline"
                  >
                    Find a replacement
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {!review ? (
          canDraft ? (
            <StartWeek
              locationId={location.id}
              weekStart={weekStart}
              sets={sets}
              preselect={params.template}
            />
          ) : (
            <EmptyState
              title="This week has not been built yet"
              description="A scheduler starts it from a template."
            />
          )
        ) : (
          <WeekBody review={review} canDraft={canDraft} />
        )}
      </div>
    </>
  )
}

/** Desktop: the whole week. Phone: the days, one open at a time. */
function WeekBody({ review, canDraft }: { review: WeekReview; canDraft: boolean }) {
  const attention = review.days.flatMap((day) =>
    day.issues.map((issue) => ({ ...issue, date: day.date })),
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Slots filled" value={`${review.filled} / ${review.slots}`} />
        <Stat
          label="Days approved"
          value={`${review.days.filter((d) => d.state === 'approved' && d.slots > 0).length} / ${review.days.filter((d) => d.slots > 0).length}`}
        />
        <Stat
          label="Needs attention"
          value={String(attention.length)}
          tone={attention.length > 0 ? 'warn' : 'calm'}
        />
        <Stat label="Your overrides" value={String(review.overrides.length)} />
      </div>

      <DayStack review={review} canDraft={canDraft} />

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr] lg:items-start">
        <Card>
          <CardHeader
            title={
              attention.length === 0 ? 'Nothing needs you' : `Needs attention · ${attention.length}`
            }
            description={
              attention.length === 0
                ? 'Every slot is filled, and everyone is on hours they said they could work.'
                : 'Open the day to change any of these. None of them stops you publishing, except an empty slot you meant to fill.'
            }
          />
          {attention.length > 0 ? (
            <ul className="divide-line divide-y">
              {attention.slice(0, 10).map((issue, index) => (
                <li key={`${issue.shiftId}-${index}`} className="flex flex-wrap gap-2 px-5 py-3">
                  <span className="text-ink text-sm">{issue.message}</span>
                  <Link
                    href={`/app/schedule/review/${review.scheduleId}/${issue.date}`}
                    className="text-action ms-auto text-sm font-medium underline-offset-4 hover:underline"
                  >
                    {formatIsoDate(issue.date)}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>

        <Card>
          <CardHeader
            title="Hours this week"
            description="Amber is within six hours of overtime."
          />
          <ul className="divide-line divide-y">
            {review.hours.map((person) => (
              <li
                key={person.employmentId}
                className="flex items-center justify-between px-5 py-2.5"
              >
                <span className="text-ink text-sm">{person.displayName}</span>
                <span
                  className={
                    person.nearOvertime
                      ? 'text-warning text-sm font-semibold tabular-nums'
                      : 'text-muted text-sm tabular-nums'
                  }
                >
                  {Math.round(person.minutes / 60)} h
                  {person.nearOvertime ? <span className="sr-only"> — near overtime</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <AvailabilityLegend />
    </div>
  )
}

function Stat({
  label,
  value,
  tone = 'calm',
}: {
  label: string
  value: string
  tone?: 'calm' | 'warn'
}) {
  return (
    <div className="rounded-card border-line shadow-low border bg-white p-5">
      <p className="text-muted text-sm">{label}</p>
      <p
        className={
          tone === 'warn'
            ? 'text-warning font-display mt-1 text-3xl font-extrabold tabular-nums'
            : 'text-ink font-display mt-1 text-3xl font-extrabold tabular-nums'
        }
      >
        {value}
      </p>
    </div>
  )
}
