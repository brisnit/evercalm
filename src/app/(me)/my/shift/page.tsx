import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { NotFoundError } from '@/lib/errors'
import { isUuid } from '@/lib/uuid'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { clockLabel, type TaskView } from '@/modules/operations/items'
import { ITEM_STATE_LABELS, describeTiming } from '@/modules/operations/rules'
import { handoffAssignees } from '@/modules/operations/handoffs'
import { getMyShiftWork, STAYS_CURRENT_AFTER_END_MS } from '@/modules/operations/work'
import { formatShift } from '@/modules/scheduling/time'
import { EmptyState, TextLink } from '@/ui/primitives'
import { EmployeeShell } from '../_components/employee-shell'
import { ShiftWorkspace, type TaskCardData } from './shift-workspace'

export const metadata: Metadata = { title: 'Your shift' }
export const dynamic = 'force-dynamic'

/**
 * The shift workspace: everything you are responsible for on your current or
 * next shift, in the order you work through it.
 *
 * Phone-first. One column, large controls, and the thing that needs attention
 * at the top. No points, streaks or leaderboards: the reward for finishing is
 * that it says "Done", and the next shift knows what you left them.
 */
export default async function MyShiftWorkPage({
  searchParams,
}: {
  searchParams: Promise<{ shift?: string }>
}) {
  const { shift: shiftParam } = await searchParams
  if (shiftParam !== undefined && !isUuid(shiftParam)) notFound()
  const { actor } = await requireActorContext()
  const now = new Date()

  const loaded = await withTenant(actor.organizationId, async (tx) => {
    const found = await getMyShiftWork(tx, actor, { shiftId: shiftParam ?? null, now })
    return {
      work: found,
      assignees: found ? await handoffAssignees(tx, actor, found.shift.locationId) : [],
    }
  }).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound()
    throw error
  })
  const { work, assignees } = loaded

  if (!work) {
    return (
      <EmployeeShell>
        <h1 className="font-display text-ink text-2xl font-extrabold tracking-tight">Your shift</h1>
        <EmptyState
          className="mt-6"
          title="No shift work right now"
          description="When a shift of yours is published with duties on it, they appear here: what to do before you start, during the shift and before you leave."
          action={
            <TextLink href="/my/schedule" className="text-sm">
              See your schedule
            </TextLink>
          }
        />
      </EmployeeShell>
    )
  }

  const { shift } = work
  const tz = shift.timeZone
  const card = (task: TaskView): TaskCardData => {
    const label = ITEM_STATE_LABELS[task.state]
    const mine = task.assignedEmploymentId === actor.employmentId
    return {
      id: task.id,
      revision: task.revision,
      title: task.title,
      instructions: task.instructions,
      context: [task.runName, task.sectionTitle !== 'Tasks' ? task.sectionTitle : null]
        .filter(Boolean)
        .join(' · '),
      required: task.required,
      responseType: task.responseType,
      requiresVerification: task.requiresVerification,
      shared: task.shared,
      state: task.state,
      stateLabel: label.label,
      stateTone: label.tone,
      dueLabel: task.dueLabel,
      reason: task.reason,
      returnedNote: task.returnedNote,
      responseText: task.responseText,
      responseNumber: task.responseNumber,
      doneLine:
        task.completedByName && task.completedAtLabel
          ? `${task.status === 'skipped' ? 'Skipped' : task.status === 'awaiting_verification' ? 'Sent for checking' : 'Done'} by ${task.completedByEmploymentId === actor.employmentId ? 'you' : task.completedByName} at ${task.completedAtLabel}` +
            (task.verifiedByName ? ` · verified by ${task.verifiedByName}` : '')
          : null,
      assignedLine: !mine && task.assignedName ? `${task.assignedName}’s task` : null,
      reassignedLine: task.reassignedFromName
        ? `Handed over from ${task.reassignedFromName}`
        : null,
      canAct: work.isOpen,
      canUndo:
        task.completedByEmploymentId === actor.employmentId &&
        !task.verifiedByName &&
        now.getTime() <= shift.endsAt.getTime() + STAYS_CURRENT_AFTER_END_MS,
    }
  }

  const phaseLine =
    work.phase === 'during'
      ? `On now · ends ${clockLabel(shift.endsAt, tz)}${shift.endsNextDay ? ' (next day)' : ''}`
      : work.phase === 'after'
        ? `Ended at ${clockLabel(shift.endsAt, tz)}`
        : work.phase === 'before'
          ? `Starts at ${clockLabel(shift.startsAt, tz)}`
          : `${shift.day} · starts at ${clockLabel(shift.startsAt, tz)}`
  const opens = formatShift(work.opensAt, work.opensAt, tz)

  return (
    <EmployeeShell>
      <ShiftWorkspace
        shift={{
          id: shift.id,
          locationId: shift.locationId,
          eyebrow: [shift.locationName, shift.roleName, shift.stationName]
            .filter(Boolean)
            .join(' · '),
          day: shift.day,
          time: `${shift.time}${shift.endsNextDay ? ' (ends the next day)' : ''}`,
          phase: work.phase,
          phaseLine,
        }}
        isOpen={work.isOpen}
        opensLine={`You can start ticking things off from ${opens.day}, ${clockLabel(work.opensAt, tz)}.`}
        progress={work.progress}
        sections={[
          {
            key: 'now',
            title: 'Needs attention now',
            description: 'Overdue, due soon, blocked, or sent back.',
            items: work.buckets.now.map(card),
          },
          {
            key: 'before',
            title: 'Before your shift',
            description: 'Get these done before you start.',
            items: work.buckets.beforeShift.map(card),
          },
          {
            key: 'during',
            title: 'During your shift',
            description: null,
            items: work.buckets.remaining.map(card),
          },
          {
            key: 'leave',
            title: 'Before you leave',
            description: 'Tell the next shift what they need to know.',
            items: work.buckets.handoff.map(card),
          },
          {
            key: 'waiting',
            title: 'Waiting for a manager',
            description: 'You’ve done these. A manager checks them.',
            items: work.buckets.waiting.map(card),
          },
        ]}
        done={work.buckets.done.map(card)}
        teamTasks={work.teamTasks.map(card)}
        handedOver={work.handedOver.map((t) => ({
          id: t.id,
          title: t.title,
          to: t.assignedName ?? 'someone else',
        }))}
        handoffs={work.handoffs}
        assignees={assignees.filter((a) => a.id !== actor.employmentId)}
        nextShiftId={work.nextShiftId}
        timingHint={describeTiming('shift_start', 0)}
      />
    </EmployeeShell>
  )
}
