import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { NotFoundError } from '@/lib/errors'
import { addCalendarDays } from '@/lib/dates'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { canAtAnyLocation } from '@/server/authz/can'
import { getBoard, type Board, type BoardGroup } from '@/modules/operations/board'
import type { TaskView } from '@/modules/operations/items'
import {
  ITEM_STATE_LABELS,
  PROGRESS_STATE_LABELS,
  type Intervention,
} from '@/modules/operations/rules'
import { formatIsoDate } from '@/modules/scheduling/time'
import { HandoffCard } from '@/ui/patterns/handoff-card'
import { NoticeProvider } from '@/ui/patterns/notice-provider'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import {
  Badge,
  Card,
  CardHeader,
  Disclosure,
  EmptyState,
  PageHeader,
  ProgressBar,
} from '@/ui/primitives'
import { BoardToolbar } from './_components/board-toolbar'
import { ItemActions } from './_components/item-actions'

export const metadata: Metadata = { title: 'Operations' }
export const dynamic = 'force-dynamic'

const INTERVENTION_LABELS: Record<
  Intervention,
  { label: string; tone: 'danger' | 'warning' | 'violet' }
> = {
  blocked: { label: 'Blocked', tone: 'danger' },
  overdue: { label: 'Overdue', tone: 'danger' },
  waiting: { label: 'Waiting to verify', tone: 'violet' },
  skipped_required: { label: 'Required, skipped', tone: 'warning' },
  returned: { label: 'Sent back', tone: 'warning' },
}

/**
 * The operational board for one location and one business date.
 *
 * "Needs you now" first - the only part a manager on the floor may have time
 * for - then each shift's progress, then the shape of the day by station,
 * role and person, with handoffs alongside.
 */
export default async function OperationsBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ location?: string; date?: string }>
}) {
  const params = await searchParams
  const { actor } = await requireActorContext()

  if (!canAtAnyLocation(actor, 'checklist.view_runs')) {
    if (canAtAnyLocation(actor, 'checklist.author')) redirect('/app/operations/templates')
    if (canAtAnyLocation(actor, 'handoff.manage')) redirect('/app/operations/handoffs')
    return <PermissionDenied capabilityLabel="View checklist runs" />
  }

  const board = await withTenant(actor.organizationId, (tx) =>
    getBoard(tx, actor, { locationId: params.location ?? null, date: params.date ?? null }),
  ).catch((error: unknown) => {
    // Another location's board reads exactly like one that does not exist.
    if (error instanceof NotFoundError) notFound()
    throw error
  })
  const { location, date, totals } = board
  const needsYou = board.interventions.length

  return (
    <NoticeProvider>
      <PageHeader
        eyebrow={`Operations · ${location.name}`}
        title={date === board.today ? `Today · ${formatIsoDate(date)}` : formatIsoDate(date)}
        description={`Shift work for the business day. Times are ${location.name} time (${location.timeZone}).`}
      />
      <BoardToolbar
        basePath="/app/operations"
        locations={board.locations.map((l) => ({ id: l.id, name: l.name }))}
        locationId={location.id}
        date={date}
        previousDate={addCalendarDays(date, -1)}
        nextDate={addCalendarDays(date, 1)}
        today={board.today}
      />

      {totals.total === 0 ? (
        <EmptyState
          className="mt-6"
          title={`No shift work on ${formatIsoDate(date)}`}
          description="Work appears here once a schedule is published with shifts that a published template applies to."
          action={
            <div className="flex flex-wrap justify-center gap-3 text-sm">
              <Link
                href="/app/operations/templates"
                className="font-medium text-violet-700 underline underline-offset-4"
              >
                Templates
              </Link>
              <Link
                href={`/app/schedule?location=${location.id}`}
                className="font-medium text-violet-700 underline underline-offset-4"
              >
                Schedule
              </Link>
            </div>
          }
        />
      ) : (
        <>
          <dl className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Figure
              label="Needs you now"
              value={needsYou}
              detail="to look at"
              tone={needsYou > 0 ? 'urgent' : 'neutral'}
            />
            <Figure
              label="Waiting to verify"
              value={totals.waiting}
              detail="done, needs a check"
              tone={totals.waiting > 0 ? 'attention' : 'neutral'}
            />
            <Figure
              label="Blocked or overdue"
              value={totals.blocked + totals.overdue}
              detail={`${totals.blocked} blocked · ${totals.overdue} overdue`}
              tone={totals.blocked + totals.overdue > 0 ? 'urgent' : 'neutral'}
            />
            <Figure
              label="Finished"
              value={`${totals.percent}%`}
              detail={`${totals.done + totals.skipped} of ${totals.total} tasks`}
              tone={totals.percent === 100 ? 'good' : 'neutral'}
            />
          </dl>

          <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:items-start [&>*]:min-w-0">
            <div className="flex min-w-0 flex-col gap-5">
              <Card as="section">
                <CardHeader
                  title="Needs you now"
                  description={
                    needsYou === 0
                      ? 'Nothing is blocked, overdue or waiting for you.'
                      : 'Most urgent first.'
                  }
                />
                {needsYou > 0 ? (
                  <ul className="divide-line divide-y">
                    {board.interventions.map((item) => (
                      <li key={item.id} className="px-5 py-4">
                        <TaskLine
                          item={item}
                          board={board}
                          actorEmploymentId={actor.employmentId}
                          intervention={item.intervention}
                        />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Card>

              <Card as="section">
                <CardHeader
                  title="Shifts"
                  description={`${board.shifts.length} ${board.shifts.length === 1 ? 'shift' : 'shifts'} with work`}
                />
                <ul className="divide-line divide-y">
                  {board.shifts.map((shift) => {
                    const state = PROGRESS_STATE_LABELS[shift.state]
                    const cancelled = shift.runs.every((r) => r.cancelled)
                    return (
                      <li key={shift.shiftId} className="px-5 py-4">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-ink font-semibold">
                              {shift.assigneeName ?? 'Open shift'}
                            </p>
                            <p className="text-muted text-sm">
                              {[shift.shiftLabel, shift.roleName, shift.stationName]
                                .filter(Boolean)
                                .join(' · ')}
                            </p>
                            <p className="text-faint mt-0.5 text-xs">
                              {shift.runs
                                .map(
                                  (r) =>
                                    `${r.name} (v${r.versionNumber}${r.cancelled ? ', no longer needed' : ''})`,
                                )
                                .join(' · ')}
                            </p>
                          </div>
                          {cancelled ? (
                            <Badge tone="neutral">No longer needed</Badge>
                          ) : (
                            <Badge tone={state.tone}>{state.label}</Badge>
                          )}
                        </div>
                        {!cancelled ? (
                          <ProgressBar
                            className="mt-3"
                            value={shift.progress.percent}
                            tone={shift.state === 'complete' ? 'success' : 'violet'}
                            label={`${shift.progress.done + shift.progress.skipped} of ${shift.progress.total} finished`}
                          />
                        ) : null}
                        <Disclosure label="Tasks" count={shift.items.length} className="mt-3">
                          <ul className="flex flex-col gap-3 pt-2">
                            {shift.items.map((item) => (
                              <li
                                key={item.id}
                                className="border-line border-t pt-3 first:border-t-0 first:pt-0"
                              >
                                <TaskLine
                                  item={item}
                                  board={board}
                                  actorEmploymentId={actor.employmentId}
                                  intervention={null}
                                />
                              </li>
                            ))}
                          </ul>
                        </Disclosure>
                      </li>
                    )
                  })}
                </ul>
              </Card>
            </div>

            <div className="flex min-w-0 flex-col gap-5">
              <Card as="section">
                <CardHeader
                  title="Handoffs"
                  description={
                    board.handoffs.length === 0
                      ? 'Nothing open at this location.'
                      : 'Open, and resolved in the last day.'
                  }
                  action={
                    <Link
                      href={`/app/operations/handoffs?location=${location.id}`}
                      className="text-sm font-medium text-violet-700 underline-offset-4 hover:underline"
                    >
                      All handoffs
                    </Link>
                  }
                />
                {board.handoffs.length > 0 ? (
                  <div className="flex flex-col gap-3 p-4">
                    {board.handoffs.map((h) => (
                      <HandoffCard key={h.id} handoff={h} allowAcknowledge={false} />
                    ))}
                  </div>
                ) : null}
              </Card>

              {board.skipped.length > 0 ? (
                <Card as="section">
                  <CardHeader title="Skipped" description="With the reason given." />
                  <ul className="divide-line divide-y">
                    {board.skipped.map((item) => (
                      <li key={item.id} className="px-5 py-3 text-sm">
                        <p className="text-ink font-medium">
                          {item.title}{' '}
                          {item.required ? <Badge tone="warning">Required</Badge> : null}
                        </p>
                        <p className="text-muted">
                          {item.completedByName ?? 'Someone'}: {item.reason}
                        </p>
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}

              <Groups title="By station" groups={board.byStation} />
              <Groups title="By role" groups={board.byRole} />
              <Groups title="By person" groups={board.byEmployee} />
            </div>
          </div>
        </>
      )}
    </NoticeProvider>
  )
}

function Figure({
  label,
  value,
  detail,
  tone,
}: {
  label: string
  value: number | string
  detail: string
  tone: 'neutral' | 'attention' | 'urgent' | 'good'
}) {
  const box = {
    neutral: 'border-line bg-white',
    attention: 'border-violet-200 bg-violet-50/60',
    urgent: 'border-danger/40 bg-danger-soft/40',
    good: 'border-success/35 bg-success-soft/40',
  }[tone]
  const text = {
    neutral: 'text-ink',
    attention: 'text-violet-700',
    urgent: 'text-danger',
    good: 'text-success',
  }[tone]
  return (
    <div className={`rounded-card flex flex-col gap-0.5 border p-3.5 ${box}`}>
      <dt className="text-muted text-xs font-semibold tracking-[0.06em] uppercase">{label}</dt>
      <dd className={`font-display text-2xl font-extrabold tabular-nums ${text}`}>{value}</dd>
      <dd className="text-muted text-xs">{detail}</dd>
    </div>
  )
}

function TaskLine({
  item,
  board,
  actorEmploymentId,
  intervention,
}: {
  item: TaskView
  board: Board
  actorEmploymentId: string
  intervention: Intervention | null
}) {
  const state = ITEM_STATE_LABELS[item.state]
  const flag = intervention ? INTERVENTION_LABELS[intervention] : null
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-ink font-medium">{item.title}</p>
          <p className="text-muted text-sm">
            {[
              item.assignedName ?? 'Unassigned',
              `due ${item.dueLabel}`,
              item.runName,
              item.stationName,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <Badge tone={flag?.tone ?? state.tone}>{flag?.label ?? state.label}</Badge>
      </div>
      {item.state === 'blocked' || item.status === 'skipped' ? (
        <p className="text-ink mt-1.5 text-sm">
          <span className="text-muted">Reason:</span> {item.reason}
        </p>
      ) : null}
      {item.state === 'returned' ? (
        <p className="text-ink mt-1.5 text-sm">
          <span className="text-muted">Sent back:</span> {item.returnedNote}
        </p>
      ) : null}
      {item.responseText ? <p className="text-ink mt-1.5 text-sm">“{item.responseText}”</p> : null}
      {item.responseNumber ? (
        <p className="text-ink mt-1.5 text-sm tabular-nums">
          Recorded {Number(item.responseNumber)}
        </p>
      ) : null}
      {item.completedByName && item.completedAtLabel ? (
        <p className="text-faint mt-1 text-xs">
          {item.status === 'skipped' ? 'Skipped' : 'Done'} by {item.completedByName} at{' '}
          {item.completedAtLabel}
          {item.verifiedByName
            ? ` · verified by ${item.verifiedByName} at ${item.verifiedAtLabel}`
            : ''}
        </p>
      ) : null}
      {item.reassignedFromName ? (
        <p className="text-faint mt-1 text-xs">Handed over from {item.reassignedFromName}</p>
      ) : null}
      {!item.runCancelled ? (
        <ItemActions
          itemId={item.id}
          revision={item.revision}
          title={item.title}
          status={item.status}
          completedByMe={item.completedByEmploymentId === actorEmploymentId}
          assignedEmploymentId={item.assignedEmploymentId}
          canVerify={board.can.verify}
          canReopen={board.can.reopen}
          people={board.people}
        />
      ) : null}
    </div>
  )
}

function Groups({ title, groups }: { title: string; groups: BoardGroup[] }) {
  if (groups.length === 0) return null
  return (
    <Card as="section">
      <CardHeader title={title} />
      <ul className="flex flex-col gap-3 p-5">
        {groups.map((group) => (
          <li key={group.key}>
            <div className="mb-1 flex items-center justify-between gap-2 text-sm">
              <span className="text-ink min-w-0 truncate font-medium">{group.label}</span>
              <Badge tone={PROGRESS_STATE_LABELS[group.state].tone}>
                {PROGRESS_STATE_LABELS[group.state].label}
              </Badge>
            </div>
            <ProgressBar
              value={group.progress.percent}
              tone={group.state === 'complete' ? 'success' : 'violet'}
              label={`${group.progress.done + group.progress.skipped} of ${group.progress.total} finished${group.progress.waiting ? ` · ${group.progress.waiting} to verify` : ''}`}
            />
          </li>
        ))}
      </ul>
    </Card>
  )
}
