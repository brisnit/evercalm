import { and, eq, gt, lt } from 'drizzle-orm'
import type { Tx } from '@/server/db'
import { employmentLocations, employments, shifts } from '@/server/db/schema'
import type { Actor } from '@/server/authz'
import { can, canAtAnyLocation } from '@/server/authz/can'
import { AUDIT_ACTIONS, recordAuditEvent } from '@/server/audit'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { addCalendarDays } from '@/lib/dates'
import { isUuid } from '@/lib/uuid'
import { isIsoDate, localDateOf } from '@/modules/scheduling/time'
import {
  canSeeOperationsAt,
  canUseOperationsAdmin,
  operationsLocations,
  requireOperationsAt,
  type LocationRef,
} from './access'
import { openHandoffsAt, type HandoffView } from './handoffs'
import {
  CLEARED_COMPLETION,
  employmentNames,
  loadItemRows,
  noteFrom,
  requireItemRow,
  toTaskViews,
  transition,
  type ItemRow,
  type TaskView,
} from './items'
import { notifyOperationsPeople } from './notify'
import {
  INTERVENTION_ORDER,
  interventionFor,
  progressOf,
  progressState,
  type Intervention,
  type Progress,
  type ProgressState,
} from './rules'
import { opsRuns, opsTaskEvents } from './schema'

/*
 * THE MANAGER'S OPERATIONAL BOARD.
 *
 * One location, one business date. Built to answer "what needs me right now"
 * first - blocked, overdue, waiting for verification, required work skipped,
 * work sent back - and then how each shift, station, role and person is doing.
 *
 * The actions a manager takes from here are all interventions on one task,
 * each through the same revision-guarded transition the employee uses:
 *
 *   verify     checklist.verify    waiting for verification -> done
 *   send back  checklist.verify    waiting or done -> to do, with a note
 *   reassign   checklist.verify    open work -> another person at the location
 *   reopen     checklist.reopen    done or skipped -> to do, with a note
 */

export interface BoardShift {
  shiftId: string
  assigneeEmploymentId: string | null
  assigneeName: string | null
  shiftLabel: string
  roleName: string | null
  stationName: string | null
  startsAt: Date
  runs: {
    id: string
    name: string
    kind: string
    versionNumber: number
    cancelled: boolean
    cancellationReason: string
  }[]
  items: (TaskView & { intervention: Intervention | null })[]
  progress: Progress
  state: ProgressState
}

export interface BoardGroup {
  key: string
  label: string
  progress: Progress
  state: ProgressState
}

export interface Board {
  locations: LocationRef[]
  location: LocationRef
  date: string
  today: string
  shifts: BoardShift[]
  interventions: (TaskView & { intervention: Intervention })[]
  skipped: TaskView[]
  byStation: BoardGroup[]
  byRole: BoardGroup[]
  byEmployee: BoardGroup[]
  totals: Progress
  handoffs: HandoffView[]
  people: { id: string; name: string }[]
  can: { verify: boolean; reopen: boolean; manageHandoffs: boolean; author: boolean }
}

export function canOpenBoard(actor: Actor): boolean {
  return canAtAnyLocation(actor, 'checklist.view_runs')
}

export async function getBoard(
  tx: Tx,
  actor: Actor,
  input: { locationId?: string | null; date?: string | null; now?: Date },
): Promise<Board> {
  const now = input.now ?? new Date()
  const places = await operationsLocations(tx, actor, 'checklist.view_runs')
  if (places.length === 0) {
    if (canUseOperationsAdmin(actor)) throw new ForbiddenError('checklist.view_runs')
    throw new NotFoundError('Location not found')
  }
  if (input.locationId && !isUuid(input.locationId)) throw new NotFoundError('Location not found')
  let location = places.find((l) => l.id === input.locationId) ?? null
  if (input.locationId && !location) {
    location = await requireOperationsAt(tx, actor, input.locationId, 'checklist.view_runs')
  }
  location ??= places[0]!
  const today = localDateOf(now, location.timeZone)
  const date = input.date && isIsoDate(input.date) ? input.date : today

  const rows = await loadItemRows(
    tx,
    actor.organizationId,
    and(eq(opsRuns.locationId, location.id), eq(opsRuns.businessDate, date)),
  )
  const views = await toTaskViews(tx, actor.organizationId, rows, now)
  const withIntervention = views.map((v) => ({
    ...v,
    intervention: v.runCancelled ? null : interventionFor(v, now),
  }))
  const live = withIntervention.filter((v) => !v.runCancelled)

  const names = await employmentNames(
    tx,
    actor.organizationId,
    rows.map((r) => r.shiftAssignee),
  )
  const shiftMap = new Map<string, BoardShift>()
  for (const [index, view] of withIntervention.entries()) {
    const row = rows[index]!
    let entry = shiftMap.get(view.shiftId)
    if (!entry) {
      entry = {
        shiftId: view.shiftId,
        assigneeEmploymentId: row.shiftAssignee,
        assigneeName: row.shiftAssignee ? (names.get(row.shiftAssignee) ?? null) : null,
        shiftLabel: view.shiftLabel,
        roleName: view.roleName,
        stationName: view.stationName,
        startsAt: view.shiftStartsAt,
        runs: [],
        items: [],
        progress: progressOf([], now),
        state: 'not_started',
      }
      shiftMap.set(view.shiftId, entry)
    }
    if (!entry.runs.some((r) => r.id === view.runId)) {
      entry.runs.push({
        id: view.runId,
        name: view.runName,
        kind: view.kind,
        versionNumber: view.versionNumber,
        cancelled: view.runCancelled,
        cancellationReason: view.cancellationReason,
      })
    }
    entry.items.push(view)
  }
  const boardShifts = [...shiftMap.values()]
    .map((s) => {
      const progress = progressOf(
        s.items.filter((i) => !i.runCancelled),
        now,
      )
      return { ...s, progress, state: progressState(progress) }
    })
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())

  const group = (keyOf: (v: TaskView) => { key: string; label: string } | null): BoardGroup[] => {
    const map = new Map<string, { label: string; items: TaskView[] }>()
    for (const view of live) {
      const k = keyOf(view)
      if (!k) continue
      const entry = map.get(k.key) ?? { label: k.label, items: [] }
      entry.items.push(view)
      map.set(k.key, entry)
    }
    return [...map.entries()]
      .map(([key, { label, items }]) => {
        const progress = progressOf(items, now)
        return { key, label, progress, state: progressState(progress) }
      })
      .sort((a, b) => a.label.localeCompare(b.label))
  }

  const interventions = live
    .filter((v): v is TaskView & { intervention: Intervention } => v.intervention !== null)
    .sort(
      (a, b) =>
        INTERVENTION_ORDER[a.intervention] - INTERVENTION_ORDER[b.intervention] ||
        a.dueAt.getTime() - b.dueAt.getTime(),
    )

  return {
    locations: places,
    location,
    date,
    today,
    shifts: boardShifts,
    interventions,
    skipped: live.filter((v) => v.status === 'skipped'),
    byStation: group((v) => ({ key: v.stationName ?? '-', label: v.stationName ?? 'No station' })),
    byRole: group((v) => ({ key: v.roleName ?? '-', label: v.roleName ?? 'No role' })),
    byEmployee: group((v) =>
      v.assignedEmploymentId
        ? { key: v.assignedEmploymentId, label: v.assignedName ?? 'Someone' }
        : { key: '-', label: 'Unassigned' },
    ),
    totals: progressOf(live, now),
    handoffs: await openHandoffsAt(tx, actor, location.id, now),
    people: await peopleOnShiftAt(tx, actor.organizationId, location, date),
    can: {
      verify: can(actor, 'checklist.verify', { locationId: location.id }),
      reopen: can(actor, 'checklist.reopen', { locationId: location.id }),
      manageHandoffs: can(actor, 'handoff.manage', { locationId: location.id }),
      author: can(actor, 'checklist.author', { locationId: location.id }),
    },
  }
}

/** People working a published shift at the location on the date: who work can be handed to. */
async function peopleOnShiftAt(
  tx: Tx,
  organizationId: string,
  location: LocationRef,
  date: string,
) {
  const from = new Date(`${addCalendarDays(date, -1)}T00:00:00Z`)
  const to = new Date(`${addCalendarDays(date, 2)}T00:00:00Z`)
  const rows = await tx
    .select({
      id: shifts.publishedAssigneeEmploymentId,
      startsAt: shifts.publishedStartsAt,
      name: employments.displayName,
    })
    .from(shifts)
    .innerJoin(
      employments,
      and(
        eq(employments.organizationId, shifts.organizationId),
        eq(employments.id, shifts.publishedAssigneeEmploymentId),
      ),
    )
    .where(
      and(
        eq(shifts.organizationId, organizationId),
        eq(shifts.locationId, location.id),
        eq(shifts.publishedStatus, 'active'),
        eq(employments.status, 'active'),
        gt(shifts.publishedStartsAt, from),
        lt(shifts.publishedStartsAt, to),
      ),
    )
  const people = new Map<string, string>()
  for (const row of rows) {
    if (row.id && localDateOf(row.startsAt!, location.timeZone) === date)
      people.set(row.id, row.name)
  }
  return [...people.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// ---------------------------------------------------------------------------
// Interventions
// ---------------------------------------------------------------------------

async function requireManagedItem(
  tx: Tx,
  actor: Actor,
  itemId: string,
  capability: 'checklist.verify' | 'checklist.reopen',
): Promise<ItemRow> {
  const row = await requireItemRow(tx, actor.organizationId, itemId)
  if (!row || !canSeeOperationsAt(actor, row.locationId)) throw new NotFoundError('Task not found')
  if (!can(actor, capability, { locationId: row.locationId })) throw new ForbiddenError(capability)
  if (row.runStatus !== 'active') {
    throw new ValidationError(
      {},
      `This work is no longer needed. ${row.runCancellationReason}`.trim(),
    )
  }
  return row
}

const boardHref = (row: ItemRow) =>
  `/app/operations?location=${row.locationId}&date=${row.businessDate}`

export async function verifyTask(
  tx: Tx,
  actor: Actor,
  itemId: string,
  input: { revision: number },
  now = new Date(),
): Promise<void> {
  const row = await requireManagedItem(tx, actor, itemId, 'checklist.verify')
  if (row.item.completedByEmploymentId === actor.employmentId) {
    throw new ForbiddenError('checklist.verify', 'Someone else needs to verify your own work.')
  }
  await transition(
    tx,
    actor.organizationId,
    row,
    input.revision,
    ['awaiting_verification'],
    { status: 'done', verifiedByEmploymentId: actor.employmentId, verifiedAt: now },
    { action: 'verified', employmentId: actor.employmentId },
    now,
  )
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.OPS_TASK_VERIFIED,
    summary: `Verified "${row.taskTitle}" (${row.runName})`,
    subjectType: 'ops_task',
    subjectId: row.item.id,
    locationId: row.locationId,
  })
}

export async function returnTask(
  tx: Tx,
  actor: Actor,
  itemId: string,
  input: { revision: number; note: string },
  now = new Date(),
): Promise<void> {
  const row = await requireManagedItem(tx, actor, itemId, 'checklist.verify')
  const note = noteFrom(input.note)
  if (!note) throw new ValidationError({ note: ['Say what needs another look.'] })
  await transition(
    tx,
    actor.organizationId,
    row,
    input.revision,
    ['awaiting_verification', 'done'],
    { status: 'pending', ...CLEARED_COMPLETION, returnedNote: note },
    { action: 'returned', note, employmentId: actor.employmentId },
    now,
  )
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.OPS_TASK_RETURNED,
    summary: `Sent back "${row.taskTitle}" (${row.runName}): ${note}`,
    subjectType: 'ops_task',
    subjectId: row.item.id,
    locationId: row.locationId,
  })
  const to = row.item.assignedEmploymentId
  if (to && to !== actor.employmentId) {
    await notifyOperationsPeople(
      tx,
      actor.organizationId,
      [
        {
          employmentId: to,
          subjectType: 'ops_task',
          subjectId: row.item.id,
          title: `Sent back: ${row.taskTitle}`,
          preview: note,
          href: `/my/shift?shift=${row.item.shiftId}`,
          purpose: `returned-${row.item.revision}`,
        },
      ],
      now,
    )
  }
}

export async function reassignTask(
  tx: Tx,
  actor: Actor,
  itemId: string,
  input: { revision: number; toEmploymentId: string; note: string },
  now = new Date(),
): Promise<void> {
  const row = await requireManagedItem(tx, actor, itemId, 'checklist.verify')
  const note = noteFrom(input.note)
  if (input.toEmploymentId === row.item.assignedEmploymentId) {
    throw new ValidationError({ toEmploymentId: ['This task is already theirs.'] })
  }
  const [person] = await tx
    .select({ id: employments.id, name: employments.displayName })
    .from(employments)
    .innerJoin(
      employmentLocations,
      and(
        eq(employmentLocations.organizationId, employments.organizationId),
        eq(employmentLocations.employmentId, employments.id),
        eq(employmentLocations.locationId, row.locationId),
      ),
    )
    .where(
      and(
        eq(employments.organizationId, actor.organizationId),
        eq(employments.id, input.toEmploymentId),
        eq(employments.status, 'active'),
      ),
    )
    .limit(1)
  if (!person) {
    throw new ValidationError({ toEmploymentId: ['Choose someone who works at this location.'] })
  }
  await transition(
    tx,
    actor.organizationId,
    row,
    input.revision,
    ['pending', 'blocked'],
    {
      assignedEmploymentId: person.id,
      reassignedFromEmploymentId: row.item.assignedEmploymentId,
      reassignedAt: now,
    },
    {
      action: 'reassigned',
      note: note || `Given to ${person.name}.`,
      employmentId: actor.employmentId,
    },
    now,
  )
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.OPS_TASK_REASSIGNED,
    summary: `Gave "${row.taskTitle}" (${row.runName}) to ${person.name}`,
    subjectType: 'ops_task',
    subjectId: row.item.id,
    locationId: row.locationId,
    metadata: { from: row.item.assignedEmploymentId, to: person.id, note },
  })
  if (person.id !== actor.employmentId) {
    await notifyOperationsPeople(
      tx,
      actor.organizationId,
      [
        {
          employmentId: person.id,
          subjectType: 'ops_task',
          subjectId: row.item.id,
          title: `New task for you: ${row.taskTitle}`,
          preview: note || `${actor.displayName} gave you this from ${row.runName}.`,
          href: '/my/shift',
          purpose: `reassigned-${row.item.revision}`,
        },
      ],
      now,
    )
  }
}

export async function reopenTask(
  tx: Tx,
  actor: Actor,
  itemId: string,
  input: { revision: number; note: string },
  now = new Date(),
): Promise<void> {
  const row = await requireManagedItem(tx, actor, itemId, 'checklist.reopen')
  const note = noteFrom(input.note) || 'Reopened by a manager.'
  await transition(
    tx,
    actor.organizationId,
    row,
    input.revision,
    ['done', 'skipped'],
    { status: 'pending', ...CLEARED_COMPLETION, returnedNote: note },
    { action: 'reopened', note, employmentId: actor.employmentId },
    now,
  )
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.OPS_TASK_REOPENED,
    summary: `Reopened "${row.taskTitle}" (${row.runName}): ${note}`,
    subjectType: 'ops_task',
    subjectId: row.item.id,
    locationId: row.locationId,
  })
  const to = row.item.assignedEmploymentId
  if (to && to !== actor.employmentId) {
    await notifyOperationsPeople(
      tx,
      actor.organizationId,
      [
        {
          employmentId: to,
          subjectType: 'ops_task',
          subjectId: row.item.id,
          title: `Reopened: ${row.taskTitle}`,
          preview: note,
          href: `/my/shift?shift=${row.item.shiftId}`,
          purpose: `reopened-${row.item.revision}`,
        },
      ],
      now,
    )
  }
}

/** The task's history, oldest first, for the board's detail view. */
export async function taskHistory(tx: Tx, actor: Actor, itemId: string) {
  const row = await requireItemRow(tx, actor.organizationId, itemId)
  if (!row || !canSeeOperationsAt(actor, row.locationId)) throw new NotFoundError('Task not found')
  const events = await tx
    .select()
    .from(opsTaskEvents)
    .where(
      and(eq(opsTaskEvents.organizationId, actor.organizationId), eq(opsTaskEvents.itemId, itemId)),
    )
    .orderBy(opsTaskEvents.at)
  const names = await employmentNames(
    tx,
    actor.organizationId,
    events.map((e) => e.employmentId),
  )
  return {
    href: boardHref(row),
    events: events.map((e) => ({
      action: e.action,
      note: e.note,
      at: e.at,
      by: e.employmentId ? (names.get(e.employmentId) ?? 'Someone') : 'EverCalm',
    })),
  }
}
