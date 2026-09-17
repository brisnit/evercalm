import { and, desc, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import type { Tx } from '@/server/db'
import {
  employmentLocations,
  employments,
  locations,
  organizations,
  shifts,
} from '@/server/db/schema'
import type { Actor } from '@/server/authz'
import { can } from '@/server/authz/can'
import { AUDIT_ACTIONS, recordAuditEvent } from '@/server/audit'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { newId } from '@/lib/ids'
import { isUuid } from '@/lib/uuid'
import { formatShift, localDateOf } from '@/modules/scheduling/time'
import {
  canSeeOperationsAt,
  operationsLocations,
  requireOperationsAt,
  type LocationRef,
} from './access'
import { clockLabel, employmentNames } from './items'
import { notifyOperationsPeople } from './notify'
import { handoffCategoryLabel } from './rules'
import {
  HANDOFF_CATEGORIES,
  handoffAcknowledgements,
  handoffs,
  type HandoffCategory,
} from './schema'

/*
 * HANDOFFS: what one shift needs the next to know.
 *
 * Scoped to a location. Written by someone on a shift there (from their
 * workspace, or as a handoff task) or by a manager. Everyone who works at the
 * location sees what is open; acknowledging says "I have read this"; a manager
 * resolves it when it is dealt with.
 *
 * A handoff may be assigned to one person who works at the location. They
 * are told in the app, it waits on their Home until they have read it, and it
 * leads the handoffs on their next shift.
 *
 * Nothing is deleted: the table refuses DELETE, acknowledgements are
 * append-only, and resolving or reopening is audited with what it replaced.
 */

export const HANDOFF_LIMITS = { title: 120, body: 1500, resolution: 300 } as const

export interface HandoffView {
  id: string
  locationId: string
  locationName: string
  category: HandoffCategory
  categoryLabel: string
  priority: 'normal' | 'urgent'
  title: string
  body: string
  authorEmploymentId: string
  authorName: string
  assignedName: string | null
  assignedToMe: boolean
  shiftLabel: string | null
  businessDate: string
  createdAt: Date
  createdLabel: string
  status: 'open' | 'resolved'
  resolvedByName: string | null
  resolvedAtLabel: string | null
  resolutionNote: string
  acknowledgements: { name: string; at: string }[]
  acknowledgedByMe: boolean
  isMine: boolean
  canResolve: boolean
  fromTask: boolean
}

export async function industryOf(tx: Tx, organizationId: string): Promise<string> {
  const [row] = await tx
    .select({ industry: organizations.industry })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1)
  return row?.industry ?? ''
}

/** Everyone who works at a location may read its handoffs; so may operations roles there. */
function canReadAt(actor: Actor, locationId: string): boolean {
  return actor.locationIds.includes(locationId) || canSeeOperationsAt(actor, locationId)
}

async function toViews(
  tx: Tx,
  actor: Actor,
  rows: (typeof handoffs.$inferSelect)[],
): Promise<HandoffView[]> {
  if (rows.length === 0) return []
  const org = actor.organizationId
  const ids = rows.map((r) => r.id)
  const [acks, shiftRows, locationRows, industry] = await Promise.all([
    tx
      .select()
      .from(handoffAcknowledgements)
      .where(
        and(
          eq(handoffAcknowledgements.organizationId, org),
          inArray(handoffAcknowledgements.handoffId, ids),
        ),
      )
      .orderBy(handoffAcknowledgements.acknowledgedAt),
    tx
      .select({ id: shifts.id, startsAt: shifts.publishedStartsAt, endsAt: shifts.publishedEndsAt })
      .from(shifts)
      .where(
        and(
          eq(shifts.organizationId, org),
          inArray(
            shifts.id,
            rows
              .map((r) => r.shiftId)
              .filter((id): id is string => !!id)
              .concat(['00000000-0000-0000-0000-000000000000']),
          ),
        ),
      ),
    tx
      .select({ id: locations.id, name: locations.name, timeZone: locations.timezone })
      .from(locations)
      .where(
        and(
          eq(locations.organizationId, org),
          inArray(locations.id, [...new Set(rows.map((r) => r.locationId))]),
        ),
      ),
    industryOf(tx, org),
  ])
  const names = await employmentNames(tx, org, [
    ...rows.flatMap((r) => [
      r.authorEmploymentId,
      r.resolvedByEmploymentId,
      r.assignedEmploymentId,
    ]),
    ...acks.map((a) => a.employmentId),
  ])
  const shiftById = new Map(shiftRows.map((s) => [s.id, s]))
  const locationById = new Map(locationRows.map((l) => [l.id, l]))
  return rows.map((r) => {
    const location = locationById.get(r.locationId)!
    const shift = r.shiftId ? shiftById.get(r.shiftId) : undefined
    const label =
      shift?.startsAt && shift.endsAt
        ? formatShift(shift.startsAt, shift.endsAt, location.timeZone)
        : null
    const mine = acks.filter((a) => a.handoffId === r.id)
    return {
      id: r.id,
      locationId: r.locationId,
      locationName: location.name,
      category: r.category as HandoffCategory,
      categoryLabel: handoffCategoryLabel(r.category as HandoffCategory, industry),
      priority: r.priority as 'normal' | 'urgent',
      title: r.title,
      body: r.body,
      authorEmploymentId: r.authorEmploymentId,
      authorName: names.get(r.authorEmploymentId) ?? 'Someone',
      assignedName: r.assignedEmploymentId ? (names.get(r.assignedEmploymentId) ?? null) : null,
      assignedToMe: r.assignedEmploymentId === actor.employmentId,
      shiftLabel: label ? `${label.day}, ${label.time}` : null,
      businessDate: r.businessDate,
      createdAt: r.createdAt,
      createdLabel: `${formatShift(r.createdAt, r.createdAt, location.timeZone).day}, ${clockLabel(r.createdAt, location.timeZone)}`,
      status: r.status as 'open' | 'resolved',
      resolvedByName: r.resolvedByEmploymentId
        ? (names.get(r.resolvedByEmploymentId) ?? null)
        : null,
      resolvedAtLabel: r.resolvedAt
        ? `${formatShift(r.resolvedAt, r.resolvedAt, location.timeZone).day}, ${clockLabel(r.resolvedAt, location.timeZone)}`
        : null,
      resolutionNote: r.resolutionNote,
      acknowledgements: mine.map((a) => ({
        name: names.get(a.employmentId) ?? 'Someone',
        at: clockLabel(a.acknowledgedAt, location.timeZone),
      })),
      acknowledgedByMe: mine.some((a) => a.employmentId === actor.employmentId),
      isMine: r.authorEmploymentId === actor.employmentId,
      canResolve: can(actor, 'handoff.manage', { locationId: r.locationId }),
      fromTask: r.taskItemId !== null,
    }
  })
}

const ORDER = [
  sql`case when ${handoffs.status} = 'open' then 0 else 1 end`,
  sql`case when ${handoffs.priority} = 'urgent' then 0 else 1 end`,
  desc(handoffs.createdAt),
]

/**
 * What a person starting a shift needs: everything still open at the
 * location from before this shift ends, and what was resolved in the day
 * before it started, so "the walk-in is fixed" is not missed either.
 */
export async function handoffsForShift(
  tx: Tx,
  actor: Actor,
  shift: { locationId: string; startsAt: Date; endsAt: Date },
): Promise<HandoffView[]> {
  if (!canReadAt(actor, shift.locationId)) return []
  const since = new Date(shift.startsAt.getTime() - 24 * 3_600_000)
  const rows = await tx
    .select()
    .from(handoffs)
    .where(
      and(
        eq(handoffs.organizationId, actor.organizationId),
        eq(handoffs.locationId, shift.locationId),
        lt(handoffs.createdAt, shift.endsAt),
        or(eq(handoffs.status, 'open'), gt(handoffs.resolvedAt, since)),
      ),
    )
    .orderBy(...ORDER)
    .limit(30)
  const views = await toViews(tx, actor, rows)
  // What was handed to this person leads, still in the usual order within.
  return [...views.filter((v) => v.assignedToMe), ...views.filter((v) => !v.assignedToMe)]
}

/**
 * Open handoffs assigned to this person that they have not read yet - what
 * Home shows the moment they open the app.
 */
export async function handoffsForMe(tx: Tx, actor: Actor): Promise<HandoffView[]> {
  const rows = await tx
    .select()
    .from(handoffs)
    .where(
      and(
        eq(handoffs.organizationId, actor.organizationId),
        eq(handoffs.assignedEmploymentId, actor.employmentId),
        eq(handoffs.status, 'open'),
      ),
    )
    .orderBy(...ORDER)
    .limit(10)
  const views = await toViews(tx, actor, rows)
  return views.filter((v) => !v.acknowledgedByMe && !v.isMine && canReadAt(actor, v.locationId))
}

/**
 * The people a handoff at this location can be assigned to: everyone active
 * who works there. Only offered to someone who may read the location's
 * handoffs, so it never lists people at a location outside their reach.
 */
export async function handoffAssignees(
  tx: Tx,
  actor: Actor,
  locationId: string,
): Promise<{ id: string; name: string }[]> {
  if (!canReadAt(actor, locationId)) return []
  return tx
    .select({ id: employments.id, name: employments.displayName })
    .from(employmentLocations)
    .innerJoin(
      employments,
      and(
        eq(employments.organizationId, employmentLocations.organizationId),
        eq(employments.id, employmentLocations.employmentId),
      ),
    )
    .where(
      and(
        eq(employmentLocations.organizationId, actor.organizationId),
        eq(employmentLocations.locationId, locationId),
        eq(employments.status, 'active'),
        isNull(employments.archivedAt),
      ),
    )
    .orderBy(employments.displayName)
}

export interface HandoffList {
  locations: LocationRef[]
  location: LocationRef
  status: 'open' | 'resolved'
  handoffs: HandoffView[]
  counts: { open: number; urgent: number }
  canCreate: boolean
}

/** The manager's handoff log for one location. */
export async function listHandoffs(
  tx: Tx,
  actor: Actor,
  input: { locationId?: string | null; status?: string | null; limit?: number },
): Promise<HandoffList | null> {
  const places = await operationsLocations(tx, actor, 'checklist.view_runs')
  const managed = await operationsLocations(tx, actor, 'handoff.manage')
  const all = [...new Map([...places, ...managed].map((l) => [l.id, l])).values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  )
  if (all.length === 0) return null
  if (input.locationId && !isUuid(input.locationId)) throw new NotFoundError('Location not found')
  let location = all.find((l) => l.id === input.locationId) ?? null
  if (input.locationId && !location) {
    location = await requireOperationsAt(tx, actor, input.locationId, 'checklist.view_runs')
  }
  location ??= all[0]!
  const status = input.status === 'resolved' ? 'resolved' : 'open'
  const rows = await tx
    .select()
    .from(handoffs)
    .where(
      and(
        eq(handoffs.organizationId, actor.organizationId),
        eq(handoffs.locationId, location.id),
        eq(handoffs.status, status),
      ),
    )
    .orderBy(...ORDER)
    .limit(input.limit ?? 100)
  const [counts] = await tx
    .select({
      open: sql<number>`count(*) filter (where ${handoffs.status} = 'open')::int`,
      urgent: sql<number>`count(*) filter (where ${handoffs.status} = 'open' and ${handoffs.priority} = 'urgent')::int`,
    })
    .from(handoffs)
    .where(
      and(eq(handoffs.organizationId, actor.organizationId), eq(handoffs.locationId, location.id)),
    )
  return {
    locations: all,
    location,
    status,
    handoffs: await toViews(tx, actor, rows),
    counts: counts ?? { open: 0, urgent: 0 },
    canCreate: can(actor, 'handoff.manage', { locationId: location.id }),
  }
}

/** Open handoffs at a location, for the operational board. */
export async function openHandoffsAt(
  tx: Tx,
  actor: Actor,
  locationId: string,
  now: Date,
): Promise<HandoffView[]> {
  const since = new Date(now.getTime() - 24 * 3_600_000)
  const rows = await tx
    .select()
    .from(handoffs)
    .where(
      and(
        eq(handoffs.organizationId, actor.organizationId),
        eq(handoffs.locationId, locationId),
        or(eq(handoffs.status, 'open'), gt(handoffs.resolvedAt, since)),
      ),
    )
    .orderBy(...ORDER)
    .limit(40)
  return toViews(tx, actor, rows)
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export interface HandoffInput {
  /** Optional since round 1: the simple form asks only for the task. */
  category?: string
  priority?: string
  title: string
  body?: string
  /** Who it is for; empty for whoever is on next. */
  assignedEmploymentId?: string | null
}

export function validateHandoff(input: HandoffInput) {
  const errors: Record<string, string[]> = {}
  // No category chosen is a plain follow-up; a category that is not one of
  // ours is still refused.
  const category = input.category ? input.category : 'follow_up'
  if (!(HANDOFF_CATEGORIES as readonly string[]).includes(category)) {
    errors.category = ['Choose what this is about.']
  }
  const title = input.title.replace(/\s+/g, ' ').trim().slice(0, HANDOFF_LIMITS.title)
  if (!title) errors.title = ['Write the task: what needs doing.']
  if (Object.keys(errors).length > 0) throw new ValidationError(errors)
  return {
    category: category as HandoffCategory,
    priority: input.priority === 'urgent' ? ('urgent' as const) : ('normal' as const),
    title,
    body: (input.body ?? '').replace(/\r\n/g, '\n').trim().slice(0, HANDOFF_LIMITS.body),
  }
}

/** Insert a handoff whose author is already authorized for its location. */
export async function insertHandoff(
  tx: Tx,
  actor: Actor,
  input: HandoffInput & {
    locationId: string
    shiftId: string | null
    businessDate: string
    taskItemId?: string | null
  },
  now: Date,
): Promise<string> {
  const values = validateHandoff(input)
  const assignee = await requireAssignee(tx, actor, input.locationId, input.assignedEmploymentId)
  const id = newId()
  await tx.insert(handoffs).values({
    id,
    organizationId: actor.organizationId,
    locationId: input.locationId,
    shiftId: input.shiftId,
    businessDate: input.businessDate,
    ...values,
    authorEmploymentId: actor.employmentId,
    assignedEmploymentId: assignee?.id ?? null,
    taskItemId: input.taskItemId ?? null,
    createdAt: now,
    updatedAt: now,
  })
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.HANDOFF_CREATED,
    summary: `Left a ${values.priority === 'urgent' ? 'priority ' : ''}handoff: "${values.title}"`,
    subjectType: 'handoff',
    subjectId: id,
    locationId: input.locationId,
    metadata: {
      category: values.category,
      priority: values.priority,
      assignedEmploymentId: assignee?.id ?? null,
    },
  })
  if (assignee && assignee.id !== actor.employmentId) {
    await notifyOperationsPeople(
      tx,
      actor.organizationId,
      [
        {
          employmentId: assignee.id,
          subjectType: 'handoff',
          subjectId: id,
          title: `Handed to you: ${values.title}`,
          preview: `From ${actor.displayName}.`,
          href: '/my',
          purpose: 'assigned',
        },
      ],
      now,
    )
  }
  return id
}

/**
 * An assignee must be someone active who works at the handoff's location.
 * Anyone else - another location, another organization, someone who has
 * left, or an id that is not ours - is refused as a field error, without
 * saying which.
 */
async function requireAssignee(
  tx: Tx,
  actor: Actor,
  locationId: string,
  employmentId: string | null | undefined,
): Promise<{ id: string } | null> {
  if (!employmentId) return null
  const refuse = () =>
    new ValidationError({ assignedEmploymentId: ['Choose someone who works at this location.'] })
  if (!isUuid(employmentId)) throw refuse()
  const [row] = await tx
    .select({ id: employments.id })
    .from(employmentLocations)
    .innerJoin(
      employments,
      and(
        eq(employments.organizationId, employmentLocations.organizationId),
        eq(employments.id, employmentLocations.employmentId),
      ),
    )
    .where(
      and(
        eq(employmentLocations.organizationId, actor.organizationId),
        eq(employmentLocations.locationId, locationId),
        eq(employmentLocations.employmentId, employmentId),
        eq(employments.status, 'active'),
        isNull(employments.archivedAt),
      ),
    )
    .limit(1)
  if (!row) throw refuse()
  return row
}

/**
 * Leave a handoff. From a shift: the person on it (or a manager at its
 * location). Without a shift: a manager holding handoff.manage there.
 */
export async function createHandoff(
  tx: Tx,
  actor: Actor,
  input: HandoffInput & { locationId: string; shiftId: string | null },
  now = new Date(),
): Promise<string> {
  if (input.shiftId) {
    const [shift] = await tx
      .select({
        locationId: shifts.locationId,
        startsAt: shifts.publishedStartsAt,
        assignee: shifts.publishedAssigneeEmploymentId,
        status: shifts.publishedStatus,
        timeZone: locations.timezone,
      })
      .from(shifts)
      .innerJoin(
        locations,
        and(
          eq(locations.organizationId, shifts.organizationId),
          eq(locations.id, shifts.locationId),
        ),
      )
      .where(and(eq(shifts.organizationId, actor.organizationId), eq(shifts.id, input.shiftId)))
      .limit(1)
    const mine = shift?.assignee === actor.employmentId
    if (!shift || shift.status !== 'active' || !shift.startsAt)
      throw new NotFoundError('Shift not found')
    if (!mine) {
      if (!canSeeOperationsAt(actor, shift.locationId)) throw new NotFoundError('Shift not found')
      if (!can(actor, 'handoff.manage', { locationId: shift.locationId }))
        throw new ForbiddenError('handoff.manage')
    }
    return insertHandoff(
      tx,
      actor,
      {
        ...input,
        locationId: shift.locationId,
        businessDate: localDateOf(shift.startsAt, shift.timeZone),
      },
      now,
    )
  }
  const location = await requireOperationsAt(tx, actor, input.locationId, 'handoff.manage')
  return insertHandoff(
    tx,
    actor,
    {
      ...input,
      locationId: location.id,
      shiftId: null,
      businessDate: localDateOf(now, location.timeZone),
    },
    now,
  )
}

async function requireReadable(tx: Tx, actor: Actor, handoffId: string) {
  const [row] = await tx
    .select()
    .from(handoffs)
    .where(and(eq(handoffs.organizationId, actor.organizationId), eq(handoffs.id, handoffId)))
    .limit(1)
  if (!row || !canReadAt(actor, row.locationId)) throw new NotFoundError('Handoff not found')
  return row
}

export async function acknowledgeHandoff(
  tx: Tx,
  actor: Actor,
  handoffId: string,
  now = new Date(),
): Promise<void> {
  await requireReadable(tx, actor, handoffId)
  await tx
    .insert(handoffAcknowledgements)
    .values({
      id: newId(),
      organizationId: actor.organizationId,
      handoffId,
      employmentId: actor.employmentId,
      acknowledgedAt: now,
    })
    .onConflictDoNothing()
}

export async function resolveHandoff(
  tx: Tx,
  actor: Actor,
  handoffId: string,
  rawNote: string,
  now = new Date(),
): Promise<void> {
  const row = await requireReadable(tx, actor, handoffId)
  if (
    !canSeeOperationsAt(actor, row.locationId) &&
    !can(actor, 'handoff.manage', { locationId: row.locationId })
  ) {
    throw new ForbiddenError('handoff.manage')
  }
  if (!can(actor, 'handoff.manage', { locationId: row.locationId }))
    throw new ForbiddenError('handoff.manage')
  const note = rawNote.replace(/\s+/g, ' ').trim().slice(0, HANDOFF_LIMITS.resolution)
  const updated = await tx
    .update(handoffs)
    .set({
      status: 'resolved',
      resolvedByEmploymentId: actor.employmentId,
      resolvedAt: now,
      resolutionNote: note,
      updatedAt: now,
    })
    .where(
      and(
        eq(handoffs.organizationId, actor.organizationId),
        eq(handoffs.id, handoffId),
        eq(handoffs.status, 'open'),
      ),
    )
    .returning({ id: handoffs.id })
  if (updated.length === 0) throw new ValidationError({}, 'This handoff has already been resolved.')
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.HANDOFF_RESOLVED,
    summary: `Resolved the handoff "${row.title}"`,
    subjectType: 'handoff',
    subjectId: handoffId,
    locationId: row.locationId,
    metadata: { resolutionNote: note },
  })
  if (row.authorEmploymentId !== actor.employmentId) {
    await notifyOperationsPeople(
      tx,
      actor.organizationId,
      [
        {
          employmentId: row.authorEmploymentId,
          subjectType: 'handoff',
          subjectId: handoffId,
          title: `Your handoff was resolved: ${row.title}`,
          preview: note || `Resolved by ${actor.displayName}.`,
          href: '/my/shift',
          purpose: `resolved-${now.getTime()}`,
        },
      ],
      now,
    )
  }
}

export async function reopenHandoff(
  tx: Tx,
  actor: Actor,
  handoffId: string,
  now = new Date(),
): Promise<void> {
  const row = await requireReadable(tx, actor, handoffId)
  if (!can(actor, 'handoff.manage', { locationId: row.locationId }))
    throw new ForbiddenError('handoff.manage')
  const updated = await tx
    .update(handoffs)
    .set({
      status: 'open',
      resolvedByEmploymentId: null,
      resolvedAt: null,
      resolutionNote: '',
      updatedAt: now,
    })
    .where(
      and(
        eq(handoffs.organizationId, actor.organizationId),
        eq(handoffs.id, handoffId),
        eq(handoffs.status, 'resolved'),
      ),
    )
    .returning({ id: handoffs.id })
  if (updated.length === 0) throw new ValidationError({}, 'This handoff is already open.')
  // The resolution being undone is kept here, since the row no longer holds it.
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.HANDOFF_REOPENED,
    summary: `Reopened the handoff "${row.title}"`,
    subjectType: 'handoff',
    subjectId: handoffId,
    locationId: row.locationId,
    metadata: {
      previouslyResolvedBy: row.resolvedByEmploymentId,
      previouslyResolvedAt: row.resolvedAt?.toISOString() ?? null,
      previousResolutionNote: row.resolutionNote,
    },
  })
}
