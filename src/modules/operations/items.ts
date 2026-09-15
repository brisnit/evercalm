import { and, eq, inArray, sql, type SQL } from 'drizzle-orm'
import type { Tx } from '@/server/db'
import { employments, jobRoles, locations, shifts, stations } from '@/server/db/schema'
import { newId } from '@/lib/ids'
import { formatShift, localDateOf } from '@/modules/scheduling/time'
import { StaleTaskError } from './access'
import { itemState, type ItemState } from './rules'
import { opsRuns, opsSections, opsTaskEvents, opsTaskItems, opsTasks } from './schema'

/*
 * TASK ITEMS AS PEOPLE SEE THEM, and the one way they change.
 *
 * Shared by the employee workspace and the manager board, so a task reads the
 * same on both and every change goes through `transition()`: a conditional
 * UPDATE on the item's revision and current status, plus an event row. Two
 * people pressing Done together produce one completion; the second is told
 * the task changed, and nothing is overwritten.
 */

const ROW = {
  item: opsTaskItems,
  runName: opsRuns.name,
  runKind: opsRuns.kind,
  runStatus: opsRuns.status,
  runCancellationReason: opsRuns.cancellationReason,
  runVersionNumber: opsRuns.versionNumber,
  runAssignee: opsRuns.assigneeEmploymentId,
  locationId: opsRuns.locationId,
  businessDate: opsRuns.businessDate,
  taskTitle: opsTasks.title,
  instructions: opsTasks.instructions,
  required: opsTasks.required,
  responseType: opsTasks.responseType,
  requiresVerification: opsTasks.requiresVerification,
  shared: opsTasks.shared,
  taskPosition: opsTasks.position,
  sectionTitle: opsSections.title,
  sectionPosition: opsSections.position,
  shiftStartsAt: shifts.publishedStartsAt,
  shiftEndsAt: shifts.publishedEndsAt,
  shiftAssignee: shifts.publishedAssigneeEmploymentId,
  shiftStatus: shifts.publishedStatus,
  locationName: locations.name,
  timeZone: locations.timezone,
  roleName: jobRoles.name,
  stationName: stations.name,
}

export async function loadItemRows(tx: Tx, organizationId: string, where: SQL | undefined) {
  return tx
    .select(ROW)
    .from(opsTaskItems)
    .innerJoin(
      opsRuns,
      and(
        eq(opsRuns.organizationId, opsTaskItems.organizationId),
        eq(opsRuns.id, opsTaskItems.runId),
      ),
    )
    .innerJoin(
      opsTasks,
      and(
        eq(opsTasks.organizationId, opsTaskItems.organizationId),
        eq(opsTasks.id, opsTaskItems.taskId),
      ),
    )
    .innerJoin(
      opsSections,
      and(
        eq(opsSections.organizationId, opsTasks.organizationId),
        eq(opsSections.id, opsTasks.sectionId),
      ),
    )
    .innerJoin(
      shifts,
      and(
        eq(shifts.organizationId, opsTaskItems.organizationId),
        eq(shifts.id, opsTaskItems.shiftId),
      ),
    )
    .innerJoin(
      locations,
      and(
        eq(locations.organizationId, opsRuns.organizationId),
        eq(locations.id, opsRuns.locationId),
      ),
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
    .where(and(eq(opsTaskItems.organizationId, organizationId), where))
    .orderBy(opsTaskItems.dueAt, opsSections.position, opsTasks.position)
}

export type ItemRow = Awaited<ReturnType<typeof loadItemRows>>[number]

export interface TaskView {
  id: string
  runId: string
  shiftId: string
  revision: number
  title: string
  instructions: string
  sectionTitle: string
  runName: string
  kind: string
  versionNumber: number
  required: boolean
  responseType: string
  requiresVerification: boolean
  shared: boolean
  status: string
  state: ItemState
  dueAt: Date
  /** "4:30 PM", or "12:45 AM (next day)" when due after the shift's start date. */
  dueLabel: string
  position: number
  responseText: string
  responseNumber: string | null
  reason: string
  returnedNote: string
  assignedEmploymentId: string | null
  assignedName: string | null
  completedByEmploymentId: string | null
  completedByName: string | null
  completedAt: Date | null
  completedAtLabel: string | null
  verifiedByName: string | null
  verifiedAtLabel: string | null
  reassignedFromName: string | null
  handoffId: string | null
  locationId: string
  locationName: string
  timeZone: string
  businessDate: string
  shiftStartsAt: Date
  shiftEndsAt: Date
  shiftLabel: string
  shiftAssigneeEmploymentId: string | null
  roleName: string | null
  stationName: string | null
  runCancelled: boolean
  cancellationReason: string
}

const CLOCK = new Map<string, Intl.DateTimeFormat>()

/** "4:30 PM" at the location - the same form scheduling uses. */
export function clockLabel(instant: Date, timeZone: string): string {
  let f = CLOCK.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' })
    CLOCK.set(timeZone, f)
  }
  return f.format(instant)
}

export async function employmentNames(
  tx: Tx,
  organizationId: string,
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))]
  if (unique.length === 0) return new Map()
  const rows = await tx
    .select({ id: employments.id, name: employments.displayName })
    .from(employments)
    .where(and(eq(employments.organizationId, organizationId), inArray(employments.id, unique)))
  return new Map(rows.map((r) => [r.id, r.name]))
}

export async function toTaskViews(
  tx: Tx,
  organizationId: string,
  rows: readonly ItemRow[],
  now: Date,
): Promise<TaskView[]> {
  const names = await employmentNames(
    tx,
    organizationId,
    rows.flatMap((r) => [
      r.item.assignedEmploymentId,
      r.item.completedByEmploymentId,
      r.item.verifiedByEmploymentId,
      r.item.reassignedFromEmploymentId,
    ]),
  )
  const name = (id: string | null) => (id ? (names.get(id) ?? null) : null)
  return rows.map((r) => {
    const tz = r.timeZone
    const startsAt = r.shiftStartsAt!
    const endsAt = r.shiftEndsAt!
    const cancelled = r.runStatus !== 'active'
    const facts = {
      id: r.item.id,
      status: r.item.status,
      dueAt: r.item.dueAt,
      position: r.sectionPosition * 1000 + r.taskPosition,
      required: r.required,
      responseType: r.responseType,
      kind: r.runKind,
      returnedNote: r.item.returnedNote,
    }
    const dueDate = localDateOf(r.item.dueAt, tz)
    const label = formatShift(startsAt, endsAt, tz)
    return {
      ...facts,
      runId: r.item.runId,
      shiftId: r.item.shiftId,
      revision: r.item.revision,
      title: r.taskTitle,
      instructions: r.instructions,
      sectionTitle: r.sectionTitle,
      runName: r.runName,
      versionNumber: r.runVersionNumber,
      requiresVerification: r.requiresVerification,
      shared: r.shared,
      state: itemState(facts, now, cancelled),
      dueLabel:
        clockLabel(r.item.dueAt, tz) +
        (dueDate > r.businessDate
          ? ' (next day)'
          : dueDate < r.businessDate
            ? ' (day before)'
            : ''),
      responseText: r.item.responseText,
      responseNumber: r.item.responseNumber,
      reason: r.item.reason,
      assignedEmploymentId: r.item.assignedEmploymentId,
      assignedName: name(r.item.assignedEmploymentId),
      completedByEmploymentId: r.item.completedByEmploymentId,
      completedByName: name(r.item.completedByEmploymentId),
      completedAt: r.item.completedAt,
      completedAtLabel: r.item.completedAt ? clockLabel(r.item.completedAt, tz) : null,
      verifiedByName: name(r.item.verifiedByEmploymentId),
      verifiedAtLabel: r.item.verifiedAt ? clockLabel(r.item.verifiedAt, tz) : null,
      reassignedFromName: name(r.item.reassignedFromEmploymentId),
      handoffId: r.item.handoffId,
      locationId: r.locationId,
      locationName: r.locationName,
      timeZone: tz,
      businessDate: r.businessDate,
      shiftStartsAt: startsAt,
      shiftEndsAt: endsAt,
      shiftLabel: `${label.day}, ${label.time}${label.endsNextDay ? ' (next day)' : ''}`,
      shiftAssigneeEmploymentId: r.shiftAssignee,
      roleName: r.roleName,
      stationName: r.stationName,
      runCancelled: cancelled,
      cancellationReason: r.runCancellationReason,
    }
  })
}

export async function requireItemRow(
  tx: Tx,
  organizationId: string,
  itemId: string,
): Promise<ItemRow | null> {
  const [row] = await loadItemRows(tx, organizationId, eq(opsTaskItems.id, itemId))
  return row ?? null
}

export type ItemAction = (typeof opsTaskEvents.$inferInsert)['action']

/**
 * THE ONLY WAY A TASK ITEM CHANGES STATE.
 *
 * Succeeds only if the item is still at `expectedRevision` and in one of
 * `from`; otherwise throws StaleTaskError and changes nothing.
 */
export async function transition(
  tx: Tx,
  organizationId: string,
  row: ItemRow,
  expectedRevision: number,
  from: readonly string[],
  set: Partial<typeof opsTaskItems.$inferInsert>,
  event: { action: ItemAction; note?: string; employmentId: string | null },
  now: Date,
): Promise<typeof opsTaskItems.$inferSelect> {
  const [updated] = await tx
    .update(opsTaskItems)
    .set({ ...set, revision: sql`${opsTaskItems.revision} + 1`, updatedAt: now })
    .where(
      and(
        eq(opsTaskItems.organizationId, organizationId),
        eq(opsTaskItems.id, row.item.id),
        eq(opsTaskItems.revision, expectedRevision),
        inArray(opsTaskItems.status, [...from]),
      ),
    )
    .returning()
  if (!updated) throw new StaleTaskError()
  await tx.insert(opsTaskEvents).values({
    id: newId(),
    organizationId,
    itemId: row.item.id,
    runId: row.item.runId,
    action: event.action,
    fromStatus: row.item.status,
    toStatus: updated.status,
    note: event.note ?? '',
    employmentId: event.employmentId,
    at: now,
  })
  return updated
}

/** Clears everything a completion wrote, for sending back or reopening. */
export const CLEARED_COMPLETION = {
  completedByEmploymentId: null,
  completedAt: null,
  verifiedByEmploymentId: null,
  verifiedAt: null,
  responseText: '',
  responseNumber: null,
  reason: '',
} satisfies Partial<typeof opsTaskItems.$inferInsert>

/** Short free text from a form, for reasons and notes. */
export function noteFrom(raw: string, max = 300): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, max)
}
