import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { can, canAtAnyLocation } from '@/server/authz/can'
import { locationsWhere } from '@/modules/scheduling/access'
import {
  listTemplates,
  loadWeek,
  previewPublication,
  type BoardShift,
} from '@/modules/scheduling/service'
import {
  formatDuration,
  formatIsoDate,
  formatTimeOfDay,
  isIsoDate,
  isoWeekday,
  localDateOf,
  weekStartOf,
} from '@/modules/scheduling/time'
import { listJobRoles, listStations } from '@/modules/structure/service'
import { Badge, Card, CardHeader, EmptyState, PageHeader } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { WeekToolbar } from './_components/week-toolbar'
import { PublishPanel } from './_components/publish-panel'
import { AddShiftForm } from './_components/add-shift-form'
import { ApplyTemplatesForm } from './_components/apply-templates-form'

export const metadata: Metadata = { title: 'Schedule' }
export const dynamic = 'force-dynamic'

/**
 * The week board.
 *
 * One location, one local week. Staffing and conflicts are summarised before
 * the detail, publication is a deliberate step with the exact list of people
 * who will be told, and every shift links to where it is changed.
 *
 * Seven columns on a wide screen; on anything narrower the same days stack,
 * so nothing scrolls sideways and each shift stays readable.
 */
export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ location?: string; week?: string }>
}) {
  const params = await searchParams
  const { actor } = await requireActorContext()

  if (!canAtAnyLocation(actor, 'schedule.view_all')) {
    const decidesRequests = (['timeoff.decide', 'swap.decide', 'openshift.manage'] as const).some(
      (c) => canAtAnyLocation(actor, c),
    )
    if (decidesRequests) redirect('/app/schedule/requests')
    return <PermissionDenied capabilityLabel="View all schedules" />
  }

  const data = await withTenant(actor.organizationId, async (tx) => {
    const locations = await locationsWhere(tx, actor, 'schedule.view_all')
    const location = locations.find((l) => l.id === params.location) ?? locations[0]
    if (!location) return null
    const thisWeek = weekStartOf(localDateOf(new Date(), location.timeZone))
    const weekStart =
      params.week && isIsoDate(params.week) && isoWeekday(params.week) === 1
        ? params.week
        : thisWeek
    const board = await loadWeek(tx, actor, location.id, weekStart)
    const canPublish = can(actor, 'schedule.publish', { locationId: location.id })
    return {
      locations,
      location,
      thisWeek,
      board,
      canPublish,
      canDraft: can(actor, 'schedule.draft', { locationId: location.id }),
      templates: await listTemplates(tx, actor, location.id),
      jobRoles: await listJobRoles(tx, actor),
      stations: (await listStations(tx, actor)).filter((s) => s.locationId === location.id),
      preview:
        board.schedule && canPublish
          ? await previewPublication(tx, actor, board.schedule.id)
          : null,
    }
  })

  if (!data) {
    return (
      <EmptyState
        title="No locations to schedule"
        description="You can see schedules only for the locations you manage, and none are set up yet."
      />
    )
  }

  const { board, location } = data
  const status =
    !board.schedule || board.totals.shifts + board.totals.unpublishedChanges === 0
      ? 'empty'
      : board.schedule.status === 'draft'
        ? 'draft'
        : board.totals.unpublishedChanges > 0
          ? 'changed'
          : 'published'
  const shiftsByDay = new Map<string, BoardShift[]>()
  for (const shift of board.shifts) {
    shiftsByDay.set(shift.localDate, [...(shiftsByDay.get(shift.localDate) ?? []), shift])
  }

  return (
    <>
      <PageHeader
        eyebrow={`Schedule · ${location.name}`}
        title={`Week of ${formatIsoDate(board.weekStart)}`}
        description={`Times are ${location.name} time (${location.timeZone}).`}
      />

      <WeekToolbar
        locations={data.locations.map((l) => ({ id: l.id, name: l.name }))}
        locationId={location.id}
        weekStart={board.weekStart}
        previousWeek={board.previousWeek}
        nextWeek={board.nextWeek}
        thisWeek={data.thisWeek}
      />

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start [&>*]:min-w-0">
        <section aria-labelledby="staffing-heading">
          <h2 id="staffing-heading" className="sr-only">
            Staffing this week
          </h2>
          <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Total
              label="Shifts"
              value={String(board.totals.shifts)}
              sub={formatDuration(board.totals.scheduledMinutes)}
            />
            <Total
              label="Assigned"
              value={String(board.totals.assigned)}
              sub={`${board.totals.unassigned} to fill`}
              tone={board.totals.unassigned > 0 ? 'warning' : 'neutral'}
            />
            <Total label="Open shifts" value={String(board.totals.open)} sub="offered to claim" />
            <Total
              label="Conflicts"
              value={String(board.totals.blocking)}
              sub={`${board.totals.warnings} to check`}
              tone={board.totals.blocking > 0 ? 'danger' : 'neutral'}
            />
          </dl>
        </section>
        <PublishPanel
          scheduleId={board.schedule?.id ?? null}
          status={status}
          version={board.schedule?.publishedVersion ?? 0}
          publishedAt={
            board.schedule?.publishedAt
              ? formatIsoDate(localDateOf(board.schedule.publishedAt, location.timeZone))
              : null
          }
          preview={data.preview}
          canPublish={data.canPublish}
        />
      </div>

      <section aria-label="Shifts by day" className="mt-5">
        {board.shifts.length === 0 ? (
          <EmptyState
            title="Nothing scheduled this week"
            description={
              data.templates.length > 0
                ? 'Add shifts from your templates, or one at a time.'
                : 'Add a shift, or create templates for the patterns you repeat every week.'
            }
          />
        ) : (
          <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-7" aria-label="Days of the week">
            {board.days.map((day) => {
              const shifts = shiftsByDay.get(day.date) ?? []
              return (
                <li
                  key={day.date}
                  className="rounded-card border-line bg-raise min-w-0 border p-2.5"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2 px-1 xl:block">
                    <h3 className="text-ink text-sm font-semibold">{day.label}</h3>
                    <p className="text-muted text-xs">
                      {day.shifts === 0
                        ? 'No shifts'
                        : `${day.shifts} · ${formatDuration(day.scheduledMinutes)}`}
                      {day.unassigned > 0 ? ` · ${day.unassigned} to fill` : ''}
                    </p>
                  </div>
                  {day.timeOff.length > 0 ? (
                    <p className="text-muted mt-1 px-1 text-xs">
                      <span className="font-semibold">Off:</span>{' '}
                      {day.timeOff
                        .map((t) => `${t.displayName}${t.status === 'pending' ? ' (asked)' : ''}`)
                        .join(', ')}
                    </p>
                  ) : null}
                  <ul className="mt-2 flex flex-col gap-2">
                    {shifts.map((shift) => (
                      <li key={shift.id}>
                        <ShiftCard shift={shift} />
                      </li>
                    ))}
                  </ul>
                </li>
              )
            })}
          </ol>
        )}
      </section>

      <div className="mt-5 grid gap-5 lg:grid-cols-3 lg:items-start [&>*]:min-w-0">
        {data.canDraft ? (
          <>
            <Card>
              <CardHeader
                title="Add a shift"
                description="Pick a template to fill in the times, or enter your own."
              />
              <div className="p-5">
                <AddShiftForm
                  locationId={location.id}
                  days={board.days.map((d) => ({ date: d.date, label: d.label }))}
                  templates={data.templates.map((t) => ({
                    id: t.id,
                    name: t.name,
                    startTime: formatTimeOfDay(t.startMinute),
                    endTime: formatTimeOfDay(t.endMinute),
                    breakMinutes: t.breakMinutes,
                    jobRoleId: t.jobRoleId,
                    stationId: t.stationId,
                    notes: t.notes,
                  }))}
                  jobRoles={data.jobRoles.map((r) => ({ id: r.id, name: r.name }))}
                  stations={data.stations.map((s) => ({ id: s.id, name: s.name }))}
                  people={board.people.map((p) => ({
                    employmentId: p.employmentId,
                    label: `${p.displayName} · ${formatDuration(p.scheduledMinutes)} this week`,
                  }))}
                />
              </div>
            </Card>

            {data.templates.length > 0 ? (
              <Card>
                <CardHeader
                  title="Fill the week from templates"
                  description="Adds each template’s shifts on its days. Running it twice adds nothing twice."
                />
                <div className="p-5">
                  <ApplyTemplatesForm
                    locationId={location.id}
                    weekStart={board.weekStart}
                    templates={data.templates.map((t) => ({
                      id: t.id,
                      label: `${t.name} · ${formatTimeOfDay(t.startMinute)}–${formatTimeOfDay(t.endMinute)}`,
                    }))}
                  />
                </div>
              </Card>
            ) : null}
          </>
        ) : null}

        <Card>
          <CardHeader title="Hours this week" description="Everyone assigned to this location." />
          <ul className="divide-line divide-y px-5 pb-2">
            {board.people.map((p) => (
              <li
                key={p.employmentId}
                className="flex items-center justify-between gap-3 py-2.5 text-sm"
              >
                <span className="text-ink min-w-0 truncate">{p.displayName}</span>
                <span className="text-muted shrink-0 tabular-nums">
                  {formatDuration(p.scheduledMinutes)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  )
}

function Total({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string
  value: string
  sub: string
  tone?: 'neutral' | 'warning' | 'danger'
}) {
  const valueTone =
    tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-ink'
  return (
    <div className="border-line/70 rounded-control border bg-white px-3 py-2.5">
      <dt className="text-faint text-[0.625rem] font-semibold tracking-wide uppercase">{label}</dt>
      <dd className={`font-display mt-1 text-xl font-extrabold ${valueTone}`}>
        {value}
        <span className="text-muted block text-xs font-medium">{sub}</span>
      </dd>
    </div>
  )
}

function ShiftCard({ shift }: { shift: BoardShift }) {
  const blocking = shift.conflicts.some((c) => c.severity === 'block')
  const warnings = shift.conflicts.filter((c) => c.severity === 'warn').length
  const cancelled = shift.status === 'cancelled'
  const who = cancelled
    ? `Cancelled${shift.assigneeName ? ` · ${shift.assigneeName}` : ''}`
    : (shift.assigneeName ?? (shift.isOpen ? 'Open shift' : 'Unassigned'))
  return (
    <Link
      href={`/app/schedule/shifts/${shift.id}`}
      className={`rounded-control block border bg-white p-2.5 hover:border-violet-300 focus-visible:outline-2 focus-visible:outline-violet-600 ${
        blocking ? 'border-danger/50' : 'border-line'
      }`}
    >
      <span
        className={`text-ink block text-xs font-semibold tabular-nums ${cancelled ? 'line-through' : ''}`}
      >
        {shift.time}
        {shift.endsNextDay ? ' (next day)' : ''}
      </span>
      <span className="text-muted block truncate text-xs">
        {[shift.jobRoleName, shift.stationName].filter(Boolean).join(' · ') || 'Shift'}
      </span>
      <span
        className={`mt-1 block text-sm break-words ${
          shift.assigneeName && !cancelled ? 'text-ink font-medium' : 'text-muted italic'
        }`}
      >
        {who}
      </span>
      {blocking ||
      warnings > 0 ||
      shift.unpublishedChange ||
      shift.pendingClaims > 0 ||
      shift.activeSwapStatus ? (
        <span className="mt-1.5 flex flex-wrap gap-1">
          {blocking ? <Badge tone="danger">Conflict</Badge> : null}
          {!blocking && warnings > 0 ? <Badge tone="warning">Check</Badge> : null}
          {shift.unpublishedChange ? <Badge tone="info">Not published</Badge> : null}
          {shift.pendingClaims > 0 ? (
            <Badge tone="violet">{shift.pendingClaims} asked</Badge>
          ) : null}
          {shift.activeSwapStatus ? <Badge tone="violet">Swap</Badge> : null}
        </span>
      ) : null}
    </Link>
  )
}
