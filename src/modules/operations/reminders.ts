import { and, eq, gt, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm'
import type { Tx } from '@/server/db'
import { locations, shifts } from '@/server/db/schema'
import { clockLabel } from './items'
import { notifyOperationsPeople, type OperationsNotice } from './notify'
import { opsRuns } from './schema'

/*
 * PRE-SHIFT REMINDERS, from the background worker.
 *
 * Within the hour before a shift starts, the person on it is told once how
 * much is waiting for them. Claimed with a conditional UPDATE on
 * `reminded_at`, so concurrent workers remind once; a run whose shift changes
 * hands or times has `reminded_at` cleared by generation, so the right person
 * is reminded at the right time.
 */

export const REMINDER_WINDOW_MINUTES = 60

export async function processOperationsReminders(
  tx: Tx,
  organizationId: string,
  now: Date,
): Promise<number> {
  const until = new Date(now.getTime() + REMINDER_WINDOW_MINUTES * 60_000)
  const due = await tx
    .select({
      runId: opsRuns.id,
      assignee: opsRuns.assigneeEmploymentId,
      shiftId: opsRuns.shiftId,
      startsAt: shifts.publishedStartsAt,
      locationName: locations.name,
      timeZone: locations.timezone,
      pending: sql<number>`(select count(*)::int from ops_task_items i where i.organization_id = ${opsRuns.organizationId} and i.run_id = ${opsRuns.id} and i.status = 'pending')`,
    })
    .from(opsRuns)
    .innerJoin(
      shifts,
      and(eq(shifts.organizationId, opsRuns.organizationId), eq(shifts.id, opsRuns.shiftId)),
    )
    .innerJoin(
      locations,
      and(
        eq(locations.organizationId, opsRuns.organizationId),
        eq(locations.id, opsRuns.locationId),
      ),
    )
    .where(
      and(
        eq(opsRuns.organizationId, organizationId),
        eq(opsRuns.status, 'active'),
        isNull(opsRuns.remindedAt),
        isNotNull(opsRuns.assigneeEmploymentId),
        eq(shifts.publishedStatus, 'active'),
        gt(shifts.publishedStartsAt, now),
        lte(shifts.publishedStartsAt, until),
      ),
    )
  const withWork = due.filter((d) => d.pending > 0)
  if (withWork.length === 0) return 0

  const claimed = await tx
    .update(opsRuns)
    .set({ remindedAt: now })
    .where(
      and(
        eq(opsRuns.organizationId, organizationId),
        inArray(
          opsRuns.id,
          withWork.map((d) => d.runId),
        ),
        isNull(opsRuns.remindedAt),
      ),
    )
    .returning({ id: opsRuns.id })
  const claimedIds = new Set(claimed.map((c) => c.id))

  // One reminder per person per shift, however many templates apply to it.
  const byShift = new Map<string, { row: (typeof withWork)[number]; pending: number }>()
  for (const row of withWork) {
    if (!claimedIds.has(row.runId)) continue
    const key = `${row.shiftId}:${row.assignee}`
    const entry = byShift.get(key)
    if (entry) entry.pending += row.pending
    else byShift.set(key, { row, pending: row.pending })
  }
  const notices: OperationsNotice[] = [...byShift.values()].map(({ row, pending }) => ({
    employmentId: row.assignee!,
    subjectType: 'shift',
    subjectId: row.shiftId,
    title: `Your shift at ${row.locationName} starts at ${clockLabel(row.startsAt!, row.timeZone)}`,
    preview: `${pending} ${pending === 1 ? 'task' : 'tasks'} to work through. Open your shift to see what comes first.`,
    href: '/my/shift',
    purpose: `pre-shift-${row.startsAt!.getTime()}`,
  }))
  await notifyOperationsPeople(tx, organizationId, notices, now)
  return notices.length
}
