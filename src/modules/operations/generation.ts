import { and, eq, gt, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import type { Tx } from '@/server/db'
import { locations, shifts } from '@/server/db/schema'
import { newId } from '@/lib/ids'
import { localDateOf } from '@/modules/scheduling/time'
import { dueAt, templateApplies, type Targets } from './rules'
import {
  opsRunAssignees,
  opsRuns,
  opsTaskEvents,
  opsTaskItems,
  opsTasks,
  opsTemplateVersions,
  opsTemplates,
  opsVersionJobRoles,
  opsVersionLocations,
  opsVersionStations,
} from './schema'

/*
 * FROM A PUBLISHED SHIFT TO THE WORK ON IT.
 *
 * `syncOperationsForShifts` is the only writer of runs. It reads the shift's
 * PUBLISHED copy - what the employee was told - never the manager's live
 * edits, so nobody is asked to do work for a shift they cannot see yet.
 *
 * It is a reconciliation, so calling it twice changes nothing the second time:
 *
 *   a template applies and there is no run    create the run and its tasks
 *   the shift was cancelled                    cancel the run; finished work
 *                                              stays finished, and on record
 *   a template no longer applies (new role,    cancel the run
 *     new station)
 *   it applies again                           reactivate the same run
 *   the assignee changed (swap, claim,         move the open tasks, and write
 *     reassignment)                            down who had them
 *   the times changed                          recompute when open tasks are due
 *
 * Runs keep the template version they were created from. Publishing a new
 * version affects shifts that do not have a run yet; a shift already under
 * way is never rewritten underneath the people working it.
 *
 * Idempotency is also the database's job: runs are unique per (shift,
 * template) and task items per (run, task), and every insert is
 * ON CONFLICT DO NOTHING - two managers publishing at once create one run.
 *
 * Nothing is deleted. Runs, task items and their events refuse DELETE at the
 * grant level.
 */

export interface SyncResult {
  created: number
  cancelled: number
  reactivated: number
  reassigned: number
  rescheduled: number
}

const OPEN_STATUSES = ['pending', 'blocked'] as const

interface PublishedTemplate {
  templateId: string
  versionId: string
  versionNumber: number
  name: string
  kind: string
  targets: Targets
}

/** Every active template's published version, with who it applies to. */
export async function loadPublishedTemplates(
  tx: Tx,
  organizationId: string,
): Promise<PublishedTemplate[]> {
  const versions = await tx
    .select({
      templateId: opsTemplates.id,
      versionId: opsTemplateVersions.id,
      versionNumber: opsTemplateVersions.versionNumber,
      name: opsTemplateVersions.name,
      kind: opsTemplateVersions.kind,
    })
    .from(opsTemplates)
    .innerJoin(
      opsTemplateVersions,
      and(
        eq(opsTemplateVersions.organizationId, opsTemplates.organizationId),
        eq(opsTemplateVersions.id, opsTemplates.publishedVersionId),
      ),
    )
    .where(and(eq(opsTemplates.organizationId, organizationId), eq(opsTemplates.status, 'active')))
  if (versions.length === 0) return []
  const targets = await loadTargets(
    tx,
    organizationId,
    versions.map((v) => v.versionId),
  )
  return versions.map((v) => ({ ...v, targets: targets.get(v.versionId)! }))
}

export async function loadTargets(
  tx: Tx,
  organizationId: string,
  versionIds: readonly string[],
): Promise<Map<string, Targets>> {
  const out = new Map<
    string,
    { locationIds: string[]; jobRoleIds: string[]; stationIds: string[] }
  >(versionIds.map((id) => [id, { locationIds: [], jobRoleIds: [], stationIds: [] }]))
  if (versionIds.length === 0) return out
  const ids = [...versionIds]
  const [locs, roles, stations] = await Promise.all([
    tx
      .select({ versionId: opsVersionLocations.versionId, id: opsVersionLocations.locationId })
      .from(opsVersionLocations)
      .where(
        and(
          eq(opsVersionLocations.organizationId, organizationId),
          inArray(opsVersionLocations.versionId, ids),
        ),
      ),
    tx
      .select({ versionId: opsVersionJobRoles.versionId, id: opsVersionJobRoles.jobRoleId })
      .from(opsVersionJobRoles)
      .where(
        and(
          eq(opsVersionJobRoles.organizationId, organizationId),
          inArray(opsVersionJobRoles.versionId, ids),
        ),
      ),
    tx
      .select({ versionId: opsVersionStations.versionId, id: opsVersionStations.stationId })
      .from(opsVersionStations)
      .where(
        and(
          eq(opsVersionStations.organizationId, organizationId),
          inArray(opsVersionStations.versionId, ids),
        ),
      ),
  ])
  for (const row of locs) out.get(row.versionId)?.locationIds.push(row.id)
  for (const row of roles) out.get(row.versionId)?.jobRoleIds.push(row.id)
  for (const row of stations) out.get(row.versionId)?.stationIds.push(row.id)
  return out
}

async function loadTasks(tx: Tx, organizationId: string, versionIds: readonly string[]) {
  if (versionIds.length === 0) return new Map<string, (typeof opsTasks.$inferSelect)[]>()
  const rows = await tx
    .select()
    .from(opsTasks)
    .where(
      and(
        eq(opsTasks.organizationId, organizationId),
        inArray(opsTasks.versionId, [...versionIds]),
      ),
    )
  const out = new Map<string, (typeof opsTasks.$inferSelect)[]>()
  for (const row of rows) {
    const list = out.get(row.versionId) ?? []
    list.push(row)
    out.set(row.versionId, list)
  }
  return out
}

export async function syncOperationsForShifts(
  tx: Tx,
  organizationId: string,
  shiftIds: readonly string[],
  actorEmploymentId: string | null,
  now = new Date(),
): Promise<SyncResult> {
  const result: SyncResult = {
    created: 0,
    cancelled: 0,
    reactivated: 0,
    reassigned: 0,
    rescheduled: 0,
  }
  const ids = [...new Set(shiftIds)]
  if (ids.length === 0) return result

  const shiftRows = await tx
    .select({
      id: shifts.id,
      locationId: shifts.locationId,
      publishedAt: shifts.publishedAt,
      startsAt: shifts.publishedStartsAt,
      endsAt: shifts.publishedEndsAt,
      jobRoleId: shifts.publishedJobRoleId,
      stationId: shifts.publishedStationId,
      assignee: shifts.publishedAssigneeEmploymentId,
      status: shifts.publishedStatus,
      timeZone: locations.timezone,
    })
    .from(shifts)
    .innerJoin(
      locations,
      and(eq(locations.organizationId, shifts.organizationId), eq(locations.id, shifts.locationId)),
    )
    .where(
      and(
        eq(shifts.organizationId, organizationId),
        inArray(shifts.id, ids),
        isNotNull(shifts.publishedAt),
      ),
    )
  if (shiftRows.length === 0) return result

  const templates = await loadPublishedTemplates(tx, organizationId)
  const existingRuns = await tx
    .select()
    .from(opsRuns)
    .where(
      and(
        eq(opsRuns.organizationId, organizationId),
        inArray(
          opsRuns.shiftId,
          shiftRows.map((s) => s.id),
        ),
      ),
    )
  const runsByShift = new Map<string, (typeof opsRuns.$inferSelect)[]>()
  for (const run of existingRuns) {
    const list = runsByShift.get(run.shiftId) ?? []
    list.push(run)
    runsByShift.set(run.shiftId, list)
  }

  const taskVersionIds = new Set<string>(templates.map((t) => t.versionId))
  for (const run of existingRuns) taskVersionIds.add(run.versionId)
  const tasksByVersion = await loadTasks(tx, organizationId, [...taskVersionIds])

  for (const shift of shiftRows) {
    const startsAt = shift.startsAt!
    const endsAt = shift.endsAt!
    const active = shift.status === 'active'
    const runs = runsByShift.get(shift.id) ?? []
    const runByTemplate = new Map(runs.map((r) => [r.templateId, r]))
    const applicable = active
      ? templates.filter((t) =>
          templateApplies(t.targets, {
            locationId: shift.locationId,
            jobRoleId: shift.jobRoleId,
            stationId: shift.stationId,
          }),
        )
      : []
    const applicableIds = new Set(applicable.map((t) => t.templateId))

    // --- runs that should no longer be worked -------------------------------
    for (const run of runs) {
      if (run.status !== 'active' || applicableIds.has(run.templateId)) continue
      const reason = active ? 'The shift no longer needs this work.' : 'The shift was cancelled.'
      const cancelled = await tx
        .update(opsRuns)
        .set({ status: 'cancelled', cancelledAt: now, cancellationReason: reason, updatedAt: now })
        .where(
          and(
            eq(opsRuns.organizationId, organizationId),
            eq(opsRuns.id, run.id),
            eq(opsRuns.status, 'active'),
          ),
        )
        .returning({ id: opsRuns.id })
      if (cancelled.length === 0) continue
      result.cancelled += 1
      await recordRunEvent(
        tx,
        organizationId,
        run.id,
        'cancelled',
        reason,
        actorEmploymentId,
        now,
        [...OPEN_STATUSES, 'awaiting_verification'],
      )
    }

    if (!active) continue

    for (const template of applicable) {
      const existing = runByTemplate.get(template.templateId)

      if (!existing) {
        // Nothing new for a shift that is already over.
        if (endsAt.getTime() <= now.getTime()) continue
        const runId = newId()
        const inserted = await tx
          .insert(opsRuns)
          .values({
            id: runId,
            organizationId,
            shiftId: shift.id,
            locationId: shift.locationId,
            templateId: template.templateId,
            versionId: template.versionId,
            versionNumber: template.versionNumber,
            name: template.name,
            kind: template.kind,
            businessDate: localDateOf(startsAt, shift.timeZone),
            assigneeEmploymentId: shift.assignee,
          })
          .onConflictDoNothing()
          .returning({ id: opsRuns.id })
        if (inserted.length === 0) continue
        const tasks = tasksByVersion.get(template.versionId) ?? []
        if (tasks.length > 0) {
          const items = tasks.map((task) => ({
            id: newId(),
            organizationId,
            runId,
            versionId: template.versionId,
            taskId: task.id,
            shiftId: shift.id,
            assignedEmploymentId: shift.assignee,
            dueAt: dueAt(task, { startsAt, endsAt }),
          }))
          await tx.insert(opsTaskItems).values(items).onConflictDoNothing()
          await tx.insert(opsTaskEvents).values(
            items.map((item) => ({
              id: newId(),
              organizationId,
              itemId: item.id,
              runId,
              action: 'generated',
              toStatus: 'pending',
              employmentId: actorEmploymentId,
              at: now,
            })),
          )
        }
        await tx.insert(opsRunAssignees).values({
          id: newId(),
          organizationId,
          runId,
          fromEmploymentId: null,
          toEmploymentId: shift.assignee,
          reason: 'Published with the schedule.',
          changedByEmploymentId: actorEmploymentId,
          changedAt: now,
        })
        result.created += 1
        continue
      }

      let run = existing
      if (run.status === 'cancelled') {
        const [reactivated] = await tx
          .update(opsRuns)
          .set({ status: 'active', cancelledAt: null, cancellationReason: '', updatedAt: now })
          .where(
            and(
              eq(opsRuns.organizationId, organizationId),
              eq(opsRuns.id, run.id),
              eq(opsRuns.status, 'cancelled'),
            ),
          )
          .returning()
        if (!reactivated) continue
        run = reactivated
        result.reactivated += 1
      }

      // --- the person changed ------------------------------------------------
      if (run.assigneeEmploymentId !== shift.assignee) {
        const from = run.assigneeEmploymentId
        await tx
          .update(opsRuns)
          .set({ assigneeEmploymentId: shift.assignee, remindedAt: null, updatedAt: now })
          .where(and(eq(opsRuns.organizationId, organizationId), eq(opsRuns.id, run.id)))
        await tx.insert(opsRunAssignees).values({
          id: newId(),
          organizationId,
          runId: run.id,
          fromEmploymentId: from,
          toEmploymentId: shift.assignee,
          reason: 'The shift changed hands.',
          changedByEmploymentId: actorEmploymentId,
          changedAt: now,
        })
        // Only open work moves. Something already done, or waiting for a
        // manager, stays with the person who did it.
        const moved = await tx
          .update(opsTaskItems)
          .set({
            assignedEmploymentId: shift.assignee,
            reassignedFromEmploymentId: from,
            reassignedAt: now,
            revision: sql`${opsTaskItems.revision} + 1`,
            updatedAt: now,
          })
          .where(
            and(
              eq(opsTaskItems.organizationId, organizationId),
              eq(opsTaskItems.runId, run.id),
              inArray(opsTaskItems.status, [...OPEN_STATUSES]),
              from === null
                ? isNull(opsTaskItems.assignedEmploymentId)
                : eq(opsTaskItems.assignedEmploymentId, from),
            ),
          )
          .returning({ id: opsTaskItems.id })
        if (moved.length > 0) {
          await tx.insert(opsTaskEvents).values(
            moved.map((item) => ({
              id: newId(),
              organizationId,
              itemId: item.id,
              runId: run.id,
              action: 'reassigned',
              note: 'The shift changed hands.',
              employmentId: actorEmploymentId,
              at: now,
            })),
          )
        }
        result.reassigned += 1
      }

      // --- the times changed -------------------------------------------------
      const tasks = new Map((tasksByVersion.get(run.versionId) ?? []).map((t) => [t.id, t]))
      const openItems = await tx
        .select({ id: opsTaskItems.id, taskId: opsTaskItems.taskId, dueAt: opsTaskItems.dueAt })
        .from(opsTaskItems)
        .where(
          and(
            eq(opsTaskItems.organizationId, organizationId),
            eq(opsTaskItems.runId, run.id),
            inArray(opsTaskItems.status, [...OPEN_STATUSES]),
          ),
        )
      let moved = 0
      for (const item of openItems) {
        const task = tasks.get(item.taskId)
        if (!task) continue
        const next = dueAt(task, { startsAt, endsAt })
        if (next.getTime() === item.dueAt.getTime()) continue
        await tx
          .update(opsTaskItems)
          .set({ dueAt: next, revision: sql`${opsTaskItems.revision} + 1`, updatedAt: now })
          .where(eq(opsTaskItems.id, item.id))
        await tx.insert(opsTaskEvents).values({
          id: newId(),
          organizationId,
          itemId: item.id,
          runId: run.id,
          action: 'rescheduled',
          note: 'The shift times changed.',
          employmentId: actorEmploymentId,
          at: now,
        })
        moved += 1
      }
      const businessDate = localDateOf(startsAt, shift.timeZone)
      if (moved > 0 || run.businessDate !== businessDate) {
        await tx
          .update(opsRuns)
          .set({ businessDate, remindedAt: null, updatedAt: now })
          .where(and(eq(opsRuns.organizationId, organizationId), eq(opsRuns.id, run.id)))
        if (moved > 0) result.rescheduled += 1
      }
    }
  }

  return result
}

async function recordRunEvent(
  tx: Tx,
  organizationId: string,
  runId: string,
  action: 'cancelled',
  note: string,
  employmentId: string | null,
  now: Date,
  statuses: readonly string[],
): Promise<void> {
  const items = await tx
    .select({ id: opsTaskItems.id, status: opsTaskItems.status })
    .from(opsTaskItems)
    .where(
      and(
        eq(opsTaskItems.organizationId, organizationId),
        eq(opsTaskItems.runId, runId),
        inArray(opsTaskItems.status, [...statuses]),
      ),
    )
  if (items.length === 0) return
  await tx.insert(opsTaskEvents).values(
    items.map((item) => ({
      id: newId(),
      organizationId,
      itemId: item.id,
      runId,
      action,
      fromStatus: item.status,
      toStatus: item.status,
      note,
      employmentId,
      at: now,
    })),
  )
}

/**
 * Upcoming published shifts a newly published template could apply to, so a
 * template published on Tuesday reaches Wednesday's shifts without waiting for
 * next week's schedule. Bounded: the next 21 days.
 */
export async function generateForUpcomingShifts(
  tx: Tx,
  organizationId: string,
  locationIds: readonly string[] | null,
  actorEmploymentId: string | null,
  now = new Date(),
): Promise<SyncResult> {
  if (locationIds !== null && locationIds.length === 0) {
    return { created: 0, cancelled: 0, reactivated: 0, reassigned: 0, rescheduled: 0 }
  }
  const horizon = new Date(now.getTime() + 21 * 86_400_000)
  const rows = await tx
    .select({ id: shifts.id })
    .from(shifts)
    .where(
      and(
        eq(shifts.organizationId, organizationId),
        eq(shifts.publishedStatus, 'active'),
        gt(shifts.publishedEndsAt, now),
        sql`${shifts.publishedStartsAt} < ${horizon.toISOString()}::timestamptz`,
        locationIds === null ? undefined : inArray(shifts.locationId, [...locationIds]),
      ),
    )
  return syncOperationsForShifts(
    tx,
    organizationId,
    rows.map((r) => r.id),
    actorEmploymentId,
    now,
  )
}
