import { and, asc, eq, gt, gte, inArray, lt, ne, or, sql } from 'drizzle-orm'
import type { Tx } from '@/server/db'
import { jobRoles, locations, shifts, stations } from '@/server/db/schema'
import type { Actor } from '@/server/authz'
import { AUDIT_ACTIONS, recordAuditEvent } from '@/server/audit'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { formatShift, localDateOf } from '@/modules/scheduling/time'
import {
  handoffsForShift,
  industryOf,
  insertHandoff,
  type HandoffInput,
  type HandoffView,
} from './handoffs'
import {
  CLEARED_COMPLETION,
  loadItemRows,
  noteFrom,
  requireItemRow,
  toTaskViews,
  transition,
  type ItemRow,
  type TaskView,
} from './items'
import {
  bucketItems,
  progressOf,
  shiftPhase,
  type Progress,
  type ShiftPhase,
  type WorkspaceBuckets,
} from './rules'
import { opsRuns, opsTaskItems, opsTasks } from './schema'

/*
 * THE EMPLOYEE'S SHIFT WORKSPACE.
 *
 * One shift at a time: the one on now, or the next one. Everything the person
 * is responsible for on it, sorted into what needs attention, what to do
 * before the shift, what remains, what is waiting for a manager, the handoff
 * to leave, and what is done.
 *
 * WHOSE WORK. A task belongs to the person it is assigned to. A SHARED task
 * (restocking the side station, polishing glassware) may also be completed by
 * anyone working a shift at the same location on the same business date.
 * Anyone else gets NotFound - a colleague's task is not probeable by id.
 *
 * WHEN. Work opens 12 hours before a shift starts and closes 12 hours after
 * it ends, so a pre-shift task can be done on arrival and a late close can
 * still be recorded honestly, but nobody ticks off next Saturday's closing on
 * Monday.
 */

export const OPENS_BEFORE_START_MS = 12 * 3_600_000
export const CLOSES_AFTER_END_MS = 12 * 3_600_000
/** A shift stays "current" on the workspace this long after it ends. */
export const STAYS_CURRENT_AFTER_END_MS = 2 * 3_600_000

export interface WorkShift {
  id: string
  locationId: string
  locationName: string
  timeZone: string
  startsAt: Date
  endsAt: Date
  businessDate: string
  day: string
  time: string
  endsNextDay: boolean
  roleName: string | null
  stationName: string | null
}

export interface MyShiftWork {
  shift: WorkShift
  phase: ShiftPhase
  opensAt: Date
  isOpen: boolean
  buckets: WorkspaceBuckets<TaskView>
  progress: Progress
  /** Shared tasks on colleagues' shifts that this person may help with. */
  teamTasks: TaskView[]
  /** Tasks a manager or a swap moved to someone else. */
  handedOver: TaskView[]
  handoffs: HandoffView[]
  industry: string
  /** A later shift with work, to point at when this one is finished. */
  nextShiftId: string | null
}

async function shiftRows(tx: Tx, actor: Actor, where: ReturnType<typeof and>) {
  return tx
    .select({
      id: shifts.id,
      locationId: shifts.locationId,
      startsAt: shifts.publishedStartsAt,
      endsAt: shifts.publishedEndsAt,
      locationName: locations.name,
      timeZone: locations.timezone,
      roleName: jobRoles.name,
      stationName: stations.name,
    })
    .from(shifts)
    .innerJoin(
      locations,
      and(eq(locations.organizationId, shifts.organizationId), eq(locations.id, shifts.locationId)),
    )
    .leftJoin(
      jobRoles,
      and(
        eq(jobRoles.organizationId, shifts.organizationId),
        eq(jobRoles.id, shifts.publishedJobRoleId),
      ),
    )
    .leftJoin(
      stations,
      and(
        eq(stations.organizationId, shifts.organizationId),
        eq(stations.id, shifts.publishedStationId),
      ),
    )
    .where(
      and(
        eq(shifts.organizationId, actor.organizationId),
        eq(shifts.publishedAssigneeEmploymentId, actor.employmentId),
        eq(shifts.publishedStatus, 'active'),
        where,
      ),
    )
    .orderBy(asc(shifts.publishedStartsAt))
}

function toWorkShift(row: Awaited<ReturnType<typeof shiftRows>>[number]): WorkShift {
  const startsAt = row.startsAt!
  const endsAt = row.endsAt!
  const label = formatShift(startsAt, endsAt, row.timeZone)
  return {
    id: row.id,
    locationId: row.locationId,
    locationName: row.locationName,
    timeZone: row.timeZone,
    startsAt,
    endsAt,
    businessDate: localDateOf(startsAt, row.timeZone),
    day: label.day,
    time: label.time,
    endsNextDay: label.endsNextDay,
    roleName: row.roleName,
    stationName: row.stationName,
  }
}

/** Shifts, current first, that have work on them. */
async function shiftsWithWork(tx: Tx, actor: Actor, now: Date, limit: number) {
  const rows = await shiftRows(
    tx,
    actor,
    and(
      gt(shifts.publishedEndsAt, new Date(now.getTime() - STAYS_CURRENT_AFTER_END_MS)),
      sql`exists (select 1 from ops_runs r where r.organization_id = ${shifts.organizationId} and r.shift_id = ${shifts.id} and r.status = 'active')`,
    ),
  )
  return rows.slice(0, limit)
}

/** The shift the workspace shows: the one asked for, else the current or next one with work. */
export async function findWorkShift(
  tx: Tx,
  actor: Actor,
  now: Date,
  shiftId?: string | null,
): Promise<{ shift: WorkShift; nextShiftId: string | null } | null> {
  if (shiftId) {
    const [row] = await shiftRows(tx, actor, eq(shifts.id, shiftId))
    if (!row) throw new NotFoundError('Shift not found')
    const [, next] = await shiftsWithWork(tx, actor, now, 2)
    return { shift: toWorkShift(row), nextShiftId: next && next.id !== row.id ? next.id : null }
  }
  const [current, next] = await shiftsWithWork(tx, actor, now, 2)
  if (!current) return null
  return { shift: toWorkShift(current), nextShiftId: next?.id ?? null }
}

export async function getMyShiftWork(
  tx: Tx,
  actor: Actor,
  input: { shiftId?: string | null; now?: Date },
): Promise<MyShiftWork | null> {
  const now = input.now ?? new Date()
  const found = await findWorkShift(tx, actor, now, input.shiftId)
  if (!found) return null
  const { shift } = found
  const me = actor.employmentId

  const windowStart = new Date(shift.startsAt.getTime() - OPENS_BEFORE_START_MS)
  const windowEnd = new Date(shift.endsAt.getTime() + STAYS_CURRENT_AFTER_END_MS)

  const [mineRows, teamRows, handedRows] = await Promise.all([
    // Mine: assigned to me on this shift, or given to me for a colleague's
    // shift at the same place around the same time.
    loadItemRows(
      tx,
      actor.organizationId,
      and(
        eq(opsRuns.status, 'active'),
        eq(opsTaskItems.assignedEmploymentId, me),
        or(
          eq(opsTaskItems.shiftId, shift.id),
          and(
            eq(opsRuns.locationId, shift.locationId),
            gte(opsTaskItems.dueAt, windowStart),
            lt(opsTaskItems.dueAt, windowEnd),
          ),
        ),
      ),
    ),
    loadItemRows(
      tx,
      actor.organizationId,
      and(
        eq(opsRuns.status, 'active'),
        eq(opsTasks.shared, true),
        eq(opsRuns.locationId, shift.locationId),
        eq(opsRuns.businessDate, shift.businessDate),
        ne(opsTaskItems.shiftId, shift.id),
        or(
          ne(opsTaskItems.assignedEmploymentId, me),
          sql`${opsTaskItems.assignedEmploymentId} is null`,
        ),
        inArray(opsTaskItems.status, ['pending', 'blocked']),
      ),
    ),
    loadItemRows(
      tx,
      actor.organizationId,
      and(
        eq(opsRuns.status, 'active'),
        eq(opsTaskItems.shiftId, shift.id),
        eq(opsTaskItems.reassignedFromEmploymentId, me),
        ne(opsTaskItems.assignedEmploymentId, me),
      ),
    ),
  ])

  const [mine, teamTasks, handedOver] = await Promise.all([
    toTaskViews(tx, actor.organizationId, mineRows, now),
    toTaskViews(tx, actor.organizationId, teamRows.slice(0, 20), now),
    toTaskViews(tx, actor.organizationId, handedRows, now),
  ])
  const opensAt = new Date(shift.startsAt.getTime() - OPENS_BEFORE_START_MS)
  return {
    shift,
    phase: shiftPhase(shift, now),
    opensAt,
    isOpen: now.getTime() >= opensAt.getTime(),
    buckets: bucketItems(mine, shift, now),
    progress: progressOf(mine, now),
    teamTasks,
    handedOver,
    handoffs: await handoffsForShift(tx, actor, shift),
    industry: await industryOf(tx, actor.organizationId),
    nextShiftId: found.nextShiftId,
  }
}

export interface ShiftWorkSummary {
  shiftId: string
  day: string
  time: string
  endsNextDay: boolean
  locationName: string
  phase: ShiftPhase
  progress: Progress
  beforeShift: number
  needsAttention: number
}

/** The home-screen card: only when the current or next shift has work on it. */
export async function myShiftWorkSummary(
  tx: Tx,
  actor: Actor,
  now = new Date(),
): Promise<ShiftWorkSummary | null> {
  const work = await getMyShiftWork(tx, actor, { now })
  if (!work || work.progress.total === 0) return null
  return {
    shiftId: work.shift.id,
    day: work.shift.day,
    time: work.shift.time,
    endsNextDay: work.shift.endsNextDay,
    locationName: work.shift.locationName,
    phase: work.phase,
    progress: work.progress,
    beforeShift: work.buckets.beforeShift.length,
    needsAttention: work.buckets.now.length,
  }
}

// ---------------------------------------------------------------------------
// Doing the work
// ---------------------------------------------------------------------------

/**
 * An item this person may act on, now. Assigned to them, or shared and they
 * work at the same place that day. Anything else is not found.
 */
async function requireWorkerItem(
  tx: Tx,
  actor: Actor,
  itemId: string,
  now: Date,
): Promise<ItemRow> {
  const row = await requireItemRow(tx, actor.organizationId, itemId)
  if (!row || row.shiftStatus !== 'active') throw new NotFoundError('Task not found')

  const mine = row.item.assignedEmploymentId === actor.employmentId
  let allowed = mine
  if (!mine && row.shared) {
    const nearby = await shiftRows(
      tx,
      actor,
      and(
        eq(shifts.locationId, row.locationId),
        gt(shifts.publishedEndsAt, new Date(row.shiftStartsAt!.getTime() - 36 * 3_600_000)),
        lt(shifts.publishedStartsAt, new Date(row.shiftEndsAt!.getTime() + 36 * 3_600_000)),
      ),
    )
    allowed = nearby.some((s) => localDateOf(s.startsAt!, s.timeZone) === row.businessDate)
  }
  if (!allowed) throw new NotFoundError('Task not found')

  if (row.runStatus !== 'active') {
    throw new ValidationError(
      {},
      `This work is no longer needed. ${row.runCancellationReason}`.trim(),
    )
  }
  if (now.getTime() < row.shiftStartsAt!.getTime() - OPENS_BEFORE_START_MS) {
    throw new ValidationError({}, 'This shift’s work opens 12 hours before the shift starts.')
  }
  if (now.getTime() > row.shiftEndsAt!.getTime() + CLOSES_AFTER_END_MS) {
    throw new ValidationError(
      {},
      'This shift ended too long ago to change its work. Ask a manager.',
    )
  }
  return row
}

function numberFrom(raw: string): string {
  const cleaned = raw.trim().replace(/,/g, '')
  const value = Number(cleaned)
  if (cleaned === '' || !Number.isFinite(value) || Math.abs(value) >= 1e10) {
    throw new ValidationError({ response: ['Enter a number, like 38 or 41.5.'] })
  }
  return (Math.round(value * 100) / 100).toFixed(2)
}

export interface CompleteInput {
  revision: number
  text?: string
  number?: string
}

export async function completeTask(
  tx: Tx,
  actor: Actor,
  itemId: string,
  input: CompleteInput,
  now = new Date(),
): Promise<{ status: 'done' | 'awaiting_verification' }> {
  const row = await requireWorkerItem(tx, actor, itemId, now)
  let responseText = ''
  let responseNumber: string | null = null
  if (row.responseType === 'handoff') {
    throw new ValidationError(
      {},
      'Leave the handoff note for this task, or say there is nothing to hand over.',
    )
  }
  if (row.responseType === 'text') {
    responseText = (input.text ?? '').replace(/\r\n/g, '\n').trim().slice(0, 500)
    if (!responseText)
      throw new ValidationError({ response: ['Add a short note to complete this.'] })
  }
  if (row.responseType === 'number') responseNumber = numberFrom(input.number ?? '')

  const status = row.requiresVerification ? 'awaiting_verification' : 'done'
  await transition(
    tx,
    actor.organizationId,
    row,
    input.revision,
    ['pending', 'blocked'],
    {
      status,
      completedByEmploymentId: actor.employmentId,
      completedAt: now,
      responseText,
      responseNumber,
      reason: '',
      returnedNote: '',
      verifiedByEmploymentId: null,
      verifiedAt: null,
    },
    { action: status === 'done' ? 'completed' : 'submitted', employmentId: actor.employmentId },
    now,
  )
  return { status }
}

export async function skipTask(
  tx: Tx,
  actor: Actor,
  itemId: string,
  input: { revision: number; reason: string },
  now = new Date(),
): Promise<void> {
  const row = await requireWorkerItem(tx, actor, itemId, now)
  const reason = noteFrom(input.reason)
  if (!reason) throw new ValidationError({ reason: ['Say why this is being skipped.'] })
  await transition(
    tx,
    actor.organizationId,
    row,
    input.revision,
    ['pending', 'blocked'],
    {
      status: 'skipped',
      reason,
      returnedNote: '',
      completedByEmploymentId: actor.employmentId,
      completedAt: now,
    },
    { action: 'skipped', note: reason, employmentId: actor.employmentId },
    now,
  )
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.OPS_TASK_SKIPPED,
    summary: `Skipped "${row.taskTitle}" (${row.runName}): ${reason}`,
    subjectType: 'ops_task',
    subjectId: row.item.id,
    locationId: row.locationId,
    metadata: { required: row.required },
  })
}

export async function blockTask(
  tx: Tx,
  actor: Actor,
  itemId: string,
  input: { revision: number; reason: string },
  now = new Date(),
): Promise<void> {
  const row = await requireWorkerItem(tx, actor, itemId, now)
  const reason = noteFrom(input.reason)
  if (!reason)
    throw new ValidationError({ reason: ['Say what is stopping you, so a manager can help.'] })
  await transition(
    tx,
    actor.organizationId,
    row,
    input.revision,
    ['pending'],
    { status: 'blocked', reason },
    { action: 'blocked', note: reason, employmentId: actor.employmentId },
    now,
  )
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.OPS_TASK_BLOCKED,
    summary: `Marked "${row.taskTitle}" (${row.runName}) blocked: ${reason}`,
    subjectType: 'ops_task',
    subjectId: row.item.id,
    locationId: row.locationId,
  })
}

export async function unblockTask(
  tx: Tx,
  actor: Actor,
  itemId: string,
  input: { revision: number },
  now = new Date(),
): Promise<void> {
  const row = await requireWorkerItem(tx, actor, itemId, now)
  await transition(
    tx,
    actor.organizationId,
    row,
    input.revision,
    ['blocked'],
    { status: 'pending', reason: '' },
    { action: 'unblocked', employmentId: actor.employmentId },
    now,
  )
}

/**
 * Undo a mis-tap: the person who completed or skipped something may put it
 * back, until a manager has verified it or the shift is two hours gone.
 */
export async function undoTask(
  tx: Tx,
  actor: Actor,
  itemId: string,
  input: { revision: number },
  now = new Date(),
): Promise<void> {
  const row = await requireWorkerItem(tx, actor, itemId, now)
  if (row.item.completedByEmploymentId !== actor.employmentId) {
    throw new ValidationError(
      {},
      'Only the person who did this can undo it. Ask a manager to reopen it.',
    )
  }
  if (row.item.verifiedAt)
    throw new ValidationError({}, 'A manager has already verified this. Ask them to reopen it.')
  if (now.getTime() > row.shiftEndsAt!.getTime() + STAYS_CURRENT_AFTER_END_MS) {
    throw new ValidationError({}, 'This shift has ended. Ask a manager to reopen it.')
  }
  await transition(
    tx,
    actor.organizationId,
    row,
    input.revision,
    ['done', 'awaiting_verification', 'skipped'],
    { status: 'pending', ...CLEARED_COMPLETION },
    {
      action: 'reopened',
      note: 'Undone by the person who did it.',
      employmentId: actor.employmentId,
    },
    now,
  )
}

/** A handoff task: leave a note for the next shift, or say there is nothing to hand over. */
export async function completeHandoffTask(
  tx: Tx,
  actor: Actor,
  itemId: string,
  input: HandoffInput & { revision: number; nothingToHandOver: boolean },
  now = new Date(),
): Promise<{ status: 'done' | 'awaiting_verification'; handoffId: string | null }> {
  const row = await requireWorkerItem(tx, actor, itemId, now)
  if (row.responseType !== 'handoff') throw new NotFoundError('Task not found')
  const status = row.requiresVerification ? 'awaiting_verification' : 'done'

  let handoffId: string | null = null
  let responseText = 'Nothing to hand over.'
  if (!input.nothingToHandOver) {
    handoffId = await insertHandoff(
      tx,
      actor,
      {
        ...input,
        locationId: row.locationId,
        shiftId: row.item.shiftId,
        businessDate: row.businessDate,
        taskItemId: row.item.id,
      },
      now,
    )
    responseText = input.title.replace(/\s+/g, ' ').trim().slice(0, 120)
  }
  await transition(
    tx,
    actor.organizationId,
    row,
    input.revision,
    ['pending', 'blocked'],
    {
      status,
      completedByEmploymentId: actor.employmentId,
      completedAt: now,
      responseText,
      handoffId,
      reason: '',
      returnedNote: '',
    },
    { action: status === 'done' ? 'completed' : 'submitted', employmentId: actor.employmentId },
    now,
  )
  return { status, handoffId }
}
