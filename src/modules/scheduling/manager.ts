import { and, asc, eq, inArray, or } from 'drizzle-orm'
import type { Tx } from '@/server/db'
import { jobRoles, stations } from '@/server/db/schema'
import type { Actor } from '@/server/authz'
import { can } from '@/server/authz/can'
import { requireLocationCapability, type LocationRef } from './access'
import { hasUnpublishedChange } from './changes'
import { detectConflicts, hasBlockingConflict, type ScheduleConflict } from './conflicts'
import { conflictShift, listSchedulablePeople, loadConflictPeople } from './people'
import { openShiftClaims, schedules, shiftSwapRequests } from './schema'
import { displayNames, requireShift } from './service'
import {
  formatShift,
  formatTimeOfDay,
  localDateOf,
  localMinuteOf,
  paidMinutes,
  weekStartOf,
} from './time'

/*
 * One shift, as a manager sees it: what it is, who could take it and why
 * not, who has asked for it, and what they are allowed to do about it.
 */

export interface ShiftCandidate {
  employmentId: string
  displayName: string
  holdsRole: boolean
  weekMinutes: number
  conflicts: ScheduleConflict[]
  blocked: boolean
}

export interface ManagedShift {
  id: string
  location: LocationRef
  scheduleId: string
  scheduleStatus: string
  weekStart: string
  date: string
  startTime: string
  endTime: string
  breakMinutes: number
  notes: string
  jobRoleId: string | null
  jobRoleName: string | null
  stationId: string | null
  stationName: string | null
  assigneeEmploymentId: string | null
  assigneeName: string | null
  isOpen: boolean
  status: string
  published: boolean
  unpublishedChange: boolean
  day: string
  time: string
  endsNextDay: boolean
  paidMinutes: number
  conflicts: ScheduleConflict[]
  claims: {
    id: string
    employmentId: string
    displayName: string
    note: string
    conflicts: ScheduleConflict[]
  }[]
  swap: {
    id: string
    status: string
    kind: string
    requesterName: string
    recipientName: string
  } | null
  candidates: ShiftCandidate[]
  permissions: { draft: boolean; openShifts: boolean }
}

export async function loadShiftForManager(
  tx: Tx,
  actor: Actor,
  shiftId: string,
): Promise<ManagedShift> {
  const shift = await requireShift(tx, actor.organizationId, shiftId)
  const location = await requireLocationCapability(tx, actor, shift.locationId, 'schedule.view_all')
  const timeZone = location.timeZone

  const [schedule] = await tx
    .select({ status: schedules.status, weekStart: schedules.weekStart })
    .from(schedules)
    .where(
      and(eq(schedules.organizationId, actor.organizationId), eq(schedules.id, shift.scheduleId)),
    )

  const [role] = shift.jobRoleId
    ? await tx
        .select({ name: jobRoles.name })
        .from(jobRoles)
        .where(
          and(eq(jobRoles.organizationId, actor.organizationId), eq(jobRoles.id, shift.jobRoleId)),
        )
    : []
  const [station] = shift.stationId
    ? await tx
        .select({ name: stations.name })
        .from(stations)
        .where(
          and(eq(stations.organizationId, actor.organizationId), eq(stations.id, shift.stationId)),
        )
    : []

  const people = await listSchedulablePeople(tx, actor.organizationId, location.id)
  const claimRows = await tx
    .select()
    .from(openShiftClaims)
    .where(
      and(
        eq(openShiftClaims.organizationId, actor.organizationId),
        eq(openShiftClaims.shiftId, shiftId),
        eq(openShiftClaims.status, 'pending'),
      ),
    )
    .orderBy(asc(openShiftClaims.createdAt))

  const ids = [
    ...people.map((p) => p.employmentId),
    ...(shift.assigneeEmploymentId ? [shift.assigneeEmploymentId] : []),
    ...claimRows.map((c) => c.employmentId),
  ]
  const context = await loadConflictPeople(tx, actor.organizationId, ids, {
    from: shift.startsAt,
    to: shift.endsAt,
  })
  const target = conflictShift(shift, timeZone)
  const week = weekStartOf(localDateOf(shift.startsAt, timeZone))
  const conflictsFor = (employmentId: string) => {
    const person = context.get(employmentId)
    return person && shift.status === 'active' ? detectConflicts(target, person) : []
  }
  const weekMinutes = (employmentId: string) =>
    (context.get(employmentId)?.shifts ?? [])
      .filter((s) => s.id !== shift.id && weekStartOf(localDateOf(s.startsAt, timeZone)) === week)
      .reduce((sum, s) => sum + paidMinutes(s.startsAt, s.endsAt, s.breakMinutes), 0)

  const candidates: ShiftCandidate[] = people
    .filter((p) => p.employmentId !== shift.assigneeEmploymentId)
    .map((p) => {
      const conflicts = conflictsFor(p.employmentId)
      return {
        employmentId: p.employmentId,
        displayName: p.displayName,
        holdsRole: !shift.jobRoleId || p.jobRoleIds.includes(shift.jobRoleId),
        weekMinutes: weekMinutes(p.employmentId),
        conflicts,
        blocked: hasBlockingConflict(conflicts),
      }
    })
    .sort(
      (a, b) =>
        Number(a.blocked) - Number(b.blocked) ||
        Number(b.holdsRole) - Number(a.holdsRole) ||
        a.conflicts.length - b.conflicts.length ||
        a.weekMinutes - b.weekMinutes ||
        a.displayName.localeCompare(b.displayName),
    )

  const [swap] = await tx
    .select()
    .from(shiftSwapRequests)
    .where(
      and(
        eq(shiftSwapRequests.organizationId, actor.organizationId),
        inArray(shiftSwapRequests.status, ['pending_recipient', 'pending_manager']),
        or(eq(shiftSwapRequests.shiftId, shiftId), eq(shiftSwapRequests.recipientShiftId, shiftId)),
      ),
    )
    .limit(1)

  const names = await displayNames(tx, actor.organizationId, [
    shift.assigneeEmploymentId,
    ...claimRows.map((c) => c.employmentId),
    swap?.requesterEmploymentId,
    swap?.recipientEmploymentId,
  ])
  const label = formatShift(shift.startsAt, shift.endsAt, timeZone)

  return {
    id: shift.id,
    location,
    scheduleId: shift.scheduleId,
    scheduleStatus: schedule?.status ?? 'draft',
    weekStart: schedule?.weekStart ?? week,
    date: localDateOf(shift.startsAt, timeZone),
    startTime: formatTimeOfDay(localMinuteOf(shift.startsAt, timeZone)),
    endTime: formatTimeOfDay(localMinuteOf(shift.endsAt, timeZone)),
    breakMinutes: shift.breakMinutes,
    notes: shift.notes,
    jobRoleId: shift.jobRoleId,
    jobRoleName: role?.name ?? null,
    stationId: shift.stationId,
    stationName: station?.name ?? null,
    assigneeEmploymentId: shift.assigneeEmploymentId,
    assigneeName: shift.assigneeEmploymentId
      ? (names.get(shift.assigneeEmploymentId) ?? null)
      : null,
    isOpen: shift.isOpen,
    status: shift.status,
    published: shift.publishedAt !== null,
    unpublishedChange: schedule?.status === 'published' && hasUnpublishedChange(shift),
    day: label.day,
    time: label.time,
    endsNextDay: label.endsNextDay,
    paidMinutes: paidMinutes(shift.startsAt, shift.endsAt, shift.breakMinutes),
    conflicts: shift.assigneeEmploymentId ? conflictsFor(shift.assigneeEmploymentId) : [],
    claims: claimRows.map((c) => ({
      id: c.id,
      employmentId: c.employmentId,
      displayName: names.get(c.employmentId) ?? 'Someone',
      note: c.note,
      conflicts: conflictsFor(c.employmentId),
    })),
    swap: swap
      ? {
          id: swap.id,
          status: swap.status,
          kind: swap.kind,
          requesterName: names.get(swap.requesterEmploymentId) ?? 'Someone',
          recipientName: names.get(swap.recipientEmploymentId) ?? 'someone',
        }
      : null,
    candidates,
    permissions: {
      draft: can(actor, 'schedule.draft', { locationId: location.id }),
      openShifts: can(actor, 'openshift.manage', { locationId: location.id }),
    },
  }
}
