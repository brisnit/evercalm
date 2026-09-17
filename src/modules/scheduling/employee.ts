import { and, asc, eq, gt, inArray, isNull, lt, ne, or } from 'drizzle-orm'
import type { Tx } from '@/server/db'
import { employmentLocations, employments, jobRoles, stations } from '@/server/db/schema'
import type { Actor } from '@/server/authz'
import { accessibleLocationIds } from '@/server/authz/can'
import { NotFoundError } from '@/lib/errors'
import { loadLocations, type LocationRef } from './access'
import { detectConflicts, toSecondPerson } from './conflicts'
import { conflictShift, loadConflictPeople } from './people'
import { openShiftClaims, shiftSwapRequests, shifts, timeOffRequests } from './schema'
import { displayNames, requireShift } from './service'
import { addCalendarDays } from '@/lib/dates'
import {
  formatDuration,
  formatShift,
  isIsoDate,
  isoWeekday,
  localDateOf,
  paidMinutes,
} from './time'

/*
 * THE EMPLOYEE'S SCHEDULE.
 *
 * Reads only the PUBLISHED copy of each shift. What a manager is still
 * editing is invisible here until it is published, so nobody plans their week
 * around a draft.
 *
 * Self-access needs no capability. Nothing here can reach another person's
 * schedule except the narrow, deliberate cases: open shifts at your own
 * locations, and a colleague's upcoming shifts when you are choosing one to
 * trade for.
 */

export interface MyShift {
  id: string
  locationId: string
  locationName: string
  timeZone: string
  startsAt: Date
  endsAt: Date
  localDate: string
  day: string
  time: string
  endsNextDay: boolean
  duration: string
  breakMinutes: number
  jobRoleName: string | null
  stationName: string | null
  notes: string
  swap: MySwap | null
}

export interface MySwap {
  id: string
  kind: string
  status: string
  direction: 'outgoing' | 'incoming'
  otherName: string
  shiftId: string
  shiftLabel: string
  recipientShiftLabel: string | null
  note: string
  decisionNote: string
}

export interface OpenShift {
  id: string
  locationName: string
  day: string
  time: string
  endsNextDay: boolean
  duration: string
  jobRoleName: string | null
  stationName: string | null
  notes: string
  myClaim: { id: string; status: string } | null
  blockedReason: string | null
  warnings: string[]
}

export interface MySchedule {
  upcoming: MyShift[]
  openShifts: OpenShift[]
  swaps: MySwap[]
  claims: {
    id: string
    status: string
    shiftLabel: string
    locationName: string
    decisionNote: string
  }[]
  timeOff: { pending: number; approvedUpcoming: number }
}

const PUBLISHED_SHIFT = {
  id: shifts.id,
  locationId: shifts.locationId,
  startsAt: shifts.publishedStartsAt,
  endsAt: shifts.publishedEndsAt,
  breakMinutes: shifts.publishedBreakMinutes,
  notes: shifts.publishedNotes,
  jobRoleId: shifts.publishedJobRoleId,
  jobRoleName: jobRoles.name,
  stationName: stations.name,
  assignee: shifts.publishedAssigneeEmploymentId,
}

function toMyShift(
  row: {
    id: string
    locationId: string
    startsAt: Date | null
    endsAt: Date | null
    breakMinutes: number | null
    notes: string | null
    jobRoleName: string | null
    stationName: string | null
  },
  location: LocationRef,
): Omit<MyShift, 'swap'> {
  const startsAt = row.startsAt!
  const endsAt = row.endsAt!
  const label = formatShift(startsAt, endsAt, location.timeZone)
  return {
    id: row.id,
    locationId: location.id,
    locationName: location.name,
    timeZone: location.timeZone,
    startsAt,
    endsAt,
    localDate: localDateOf(startsAt, location.timeZone),
    day: label.day,
    time: label.time,
    endsNextDay: label.endsNextDay,
    duration: formatDuration(paidMinutes(startsAt, endsAt, row.breakMinutes ?? 0)),
    breakMinutes: row.breakMinutes ?? 0,
    jobRoleName: row.jobRoleName,
    stationName: row.stationName,
    notes: row.notes ?? '',
  }
}

async function publishedShiftRows(tx: Tx, organizationId: string, where: ReturnType<typeof and>) {
  return tx
    .select(PUBLISHED_SHIFT)
    .from(shifts)
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
      and(eq(shifts.organizationId, organizationId), eq(shifts.publishedStatus, 'active'), where),
    )
    .orderBy(asc(shifts.publishedStartsAt))
}

async function mySwaps(
  tx: Tx,
  actor: Actor,
  locationsById: Map<string, LocationRef>,
): Promise<MySwap[]> {
  const requests = await tx
    .select()
    .from(shiftSwapRequests)
    .where(
      and(
        eq(shiftSwapRequests.organizationId, actor.organizationId),
        or(
          eq(shiftSwapRequests.requesterEmploymentId, actor.employmentId),
          eq(shiftSwapRequests.recipientEmploymentId, actor.employmentId),
        ),
        ne(shiftSwapRequests.status, 'cancelled'),
      ),
    )
    .orderBy(asc(shiftSwapRequests.createdAt))
    .limit(50)
  if (requests.length === 0) return []

  const shiftIds = requests.flatMap((r) => [
    r.shiftId,
    ...(r.recipientShiftId ? [r.recipientShiftId] : []),
  ])
  const shiftRows = await tx
    .select({
      id: shifts.id,
      locationId: shifts.locationId,
      startsAt: shifts.publishedStartsAt,
      endsAt: shifts.publishedEndsAt,
    })
    .from(shifts)
    .where(and(eq(shifts.organizationId, actor.organizationId), inArray(shifts.id, shiftIds)))
  const names = await displayNames(
    tx,
    actor.organizationId,
    requests.flatMap((r) => [r.requesterEmploymentId, r.recipientEmploymentId]),
  )
  const labelFor = (id: string | null) => {
    const row = shiftRows.find((s) => s.id === id)
    const location = row ? locationsById.get(row.locationId) : undefined
    if (!row?.startsAt || !row.endsAt || !location) return null
    const l = formatShift(row.startsAt, row.endsAt, location.timeZone)
    return `${l.day}, ${l.time}`
  }

  // Keep what is still in play, and decisions from the last fortnight.
  const recent = Date.now() - 14 * 86_400_000
  return requests
    .filter(
      (r) =>
        r.status === 'pending_recipient' ||
        r.status === 'pending_manager' ||
        (r.decidedAt ?? r.updatedAt).getTime() > recent,
    )
    .map((r) => {
      const outgoing = r.requesterEmploymentId === actor.employmentId
      return {
        id: r.id,
        kind: r.kind,
        status: r.status,
        direction: outgoing ? ('outgoing' as const) : ('incoming' as const),
        otherName:
          names.get(outgoing ? r.recipientEmploymentId : r.requesterEmploymentId) ?? 'A colleague',
        shiftId: r.shiftId,
        shiftLabel: labelFor(r.shiftId) ?? 'A shift',
        recipientShiftLabel: labelFor(r.recipientShiftId),
        note: r.note,
        decisionNote: r.decisionNote,
      }
    })
}

/**
 * Your published shifts: the next four weeks by default, or one local week
 * when `weekStart` is given (the link a schedule notification carries).
 */
export async function getMySchedule(
  tx: Tx,
  actor: Actor,
  options: { weekStart?: string } = {},
  now = new Date(),
): Promise<MySchedule> {
  const locationsById = await loadLocations(tx, actor.organizationId)
  const weekStart =
    options.weekStart && isIsoDate(options.weekStart) && isoWeekday(options.weekStart) === 1
      ? options.weekStart
      : null
  // A whole local week, widened by 14 hours either side so every timezone's
  // version of that week is fetched; rows are then kept by their LOCAL date.
  const from = weekStart ? new Date(Date.parse(`${weekStart}T00:00:00Z`) - 14 * 3_600_000) : now
  const horizon = weekStart
    ? new Date(Date.parse(`${addCalendarDays(weekStart, 7)}T00:00:00Z`) + 14 * 3_600_000)
    : new Date(now.getTime() + 28 * 86_400_000)

  const upcomingRows = await publishedShiftRows(
    tx,
    actor.organizationId,
    and(
      eq(shifts.publishedAssigneeEmploymentId, actor.employmentId),
      gt(shifts.publishedEndsAt, weekStart ? from : now),
      lt(shifts.publishedStartsAt, horizon),
    ),
  )
  const swaps = await mySwaps(tx, actor, locationsById)
  const activeSwapFor = (shiftId: string) =>
    swaps.find(
      (s) =>
        (s.shiftId === shiftId || false) &&
        (s.status === 'pending_recipient' || s.status === 'pending_manager'),
    ) ?? null

  const upcoming = upcomingRows
    .filter((row) => {
      if (!weekStart) return true
      const local = localDateOf(row.startsAt!, locationsById.get(row.locationId)!.timeZone)
      return local >= weekStart && local <= addCalendarDays(weekStart, 6)
    })
    .map((row) => ({
      ...toMyShift(row, locationsById.get(row.locationId)!),
      swap: activeSwapFor(row.id),
    }))

  const openShifts = await listOpenShifts(tx, actor, locationsById, now)

  const claimRows = await tx
    .select({
      claim: openShiftClaims,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      locationId: shifts.locationId,
    })
    .from(openShiftClaims)
    .innerJoin(
      shifts,
      and(
        eq(shifts.organizationId, openShiftClaims.organizationId),
        eq(shifts.id, openShiftClaims.shiftId),
      ),
    )
    .where(
      and(
        eq(openShiftClaims.organizationId, actor.organizationId),
        eq(openShiftClaims.employmentId, actor.employmentId),
        gt(shifts.endsAt, new Date(now.getTime() - 7 * 86_400_000)),
      ),
    )
    .orderBy(asc(shifts.startsAt))

  const timeOffRows = await tx
    .select({ status: timeOffRequests.status, endsOn: timeOffRequests.endsOn })
    .from(timeOffRequests)
    .where(
      and(
        eq(timeOffRequests.organizationId, actor.organizationId),
        eq(timeOffRequests.employmentId, actor.employmentId),
        inArray(timeOffRequests.status, ['pending', 'approved']),
      ),
    )
  const today = localDateOf(now, locationsById.values().next().value?.timeZone ?? 'UTC')

  return {
    upcoming,
    openShifts,
    swaps,
    claims: claimRows
      .filter((r) => r.claim.status !== 'withdrawn')
      .map(({ claim, startsAt, endsAt, locationId }) => {
        const location = locationsById.get(locationId)!
        const l = formatShift(startsAt, endsAt, location.timeZone)
        return {
          id: claim.id,
          status:
            claim.status === 'pending' && startsAt.getTime() <= now.getTime()
              ? 'expired'
              : claim.status,
          shiftLabel: `${l.day}, ${l.time}`,
          locationName: location.name,
          decisionNote: claim.decisionNote,
        }
      }),
    timeOff: {
      pending: timeOffRows.filter((r) => r.status === 'pending').length,
      approvedUpcoming: timeOffRows.filter((r) => r.status === 'approved' && r.endsOn >= today)
        .length,
    },
  }
}

async function listOpenShifts(
  tx: Tx,
  actor: Actor,
  locationsById: Map<string, LocationRef>,
  now: Date,
): Promise<OpenShift[]> {
  if (actor.locationIds.length === 0) return []
  const rows = await tx
    .select({
      ...PUBLISHED_SHIFT,
      liveOpen: shifts.isOpen,
      liveAssignee: shifts.assigneeEmploymentId,
      liveStatus: shifts.status,
    })
    .from(shifts)
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
        eq(shifts.publishedStatus, 'active'),
        eq(shifts.publishedIsOpen, true),
        isNull(shifts.publishedAssigneeEmploymentId),
        inArray(shifts.locationId, [...actor.locationIds]),
        gt(shifts.publishedStartsAt, now),
      ),
    )
    .orderBy(asc(shifts.publishedStartsAt))
    .limit(50)
  // Something a manager has since filled or withdrawn is not offered.
  const live = rows.filter(
    (r) => r.liveOpen && r.liveAssignee === null && r.liveStatus === 'active',
  )
  if (live.length === 0) return []

  const claims = await tx
    .select({
      id: openShiftClaims.id,
      shiftId: openShiftClaims.shiftId,
      status: openShiftClaims.status,
    })
    .from(openShiftClaims)
    .where(
      and(
        eq(openShiftClaims.organizationId, actor.organizationId),
        eq(openShiftClaims.employmentId, actor.employmentId),
        inArray(
          openShiftClaims.shiftId,
          live.map((r) => r.id),
        ),
        inArray(openShiftClaims.status, ['pending', 'declined']),
      ),
    )
  const context = await loadConflictPeople(tx, actor.organizationId, [actor.employmentId], {
    from: live[0]!.startsAt!,
    to: live[live.length - 1]!.endsAt!,
  })
  const me = context.get(actor.employmentId)

  return live.map((row) => {
    const location = locationsById.get(row.locationId)!
    const base = toMyShift(row, location)
    const conflicts = me
      ? detectConflicts(
          conflictShift(
            {
              id: row.id,
              startsAt: base.startsAt,
              endsAt: base.endsAt,
              breakMinutes: base.breakMinutes,
              locationId: row.locationId,
              jobRoleId: row.jobRoleId,
            },
            location.timeZone,
          ),
          me,
        )
      : []
    const claim = claims.find((c) => c.shiftId === row.id) ?? null
    return {
      id: row.id,
      locationName: location.name,
      day: base.day,
      time: base.time,
      endsNextDay: base.endsNextDay,
      duration: base.duration,
      jobRoleName: base.jobRoleName,
      stationName: base.stationName,
      notes: base.notes,
      myClaim: claim ? { id: claim.id, status: claim.status } : null,
      blockedReason:
        (() => {
          const message = conflicts.find((c) => c.severity === 'block')?.message
          return message ? toSecondPerson(message, actor.displayName) : undefined
        })() ?? null,
      warnings: conflicts
        .filter((c) => c.severity === 'warn')
        .map((c) => toSecondPerson(c.message, actor.displayName)),
    }
  })
}

export interface MyShiftDetail {
  shift: MyShift
  isMine: boolean
  started: boolean
  colleagues: {
    employmentId: string
    displayName: string
    shifts: { id: string; label: string }[]
  }[]
}

/**
 * One published shift of your own, with what you can do about it.
 * Anyone else's shift - or one not yet published - is not found.
 */
export async function getMyShift(
  tx: Tx,
  actor: Actor,
  shiftId: string,
  now = new Date(),
): Promise<MyShiftDetail> {
  const raw = await requireShift(tx, actor.organizationId, shiftId)
  if (
    raw.publishedAt === null ||
    raw.publishedStatus !== 'active' ||
    raw.publishedAssigneeEmploymentId !== actor.employmentId
  ) {
    throw new NotFoundError('Shift not found')
  }
  const locationsById = await loadLocations(tx, actor.organizationId)
  const [row] = await publishedShiftRows(tx, actor.organizationId, eq(shifts.id, shiftId))
  if (!row) throw new NotFoundError('Shift not found')
  const location = locationsById.get(row.locationId)!
  const swaps = await mySwaps(tx, actor, locationsById)
  const shift: MyShift = {
    ...toMyShift(row, location),
    swap:
      swaps.find(
        (s) =>
          s.shiftId === shiftId &&
          (s.status === 'pending_recipient' || s.status === 'pending_manager'),
      ) ?? null,
  }
  const started = shift.startsAt.getTime() <= now.getTime()

  let colleagues: MyShiftDetail['colleagues'] = []
  if (
    !started &&
    !shift.swap &&
    raw.status === 'active' &&
    raw.assigneeEmploymentId === actor.employmentId
  ) {
    const people = await tx
      .select({ employmentId: employments.id, displayName: employments.displayName })
      .from(employments)
      .innerJoin(
        employmentLocations,
        and(
          eq(employmentLocations.organizationId, employments.organizationId),
          eq(employmentLocations.employmentId, employments.id),
        ),
      )
      .where(
        and(
          eq(employments.organizationId, actor.organizationId),
          eq(employmentLocations.locationId, row.locationId),
          eq(employments.status, 'active'),
          ne(employments.id, actor.employmentId),
        ),
      )
      .orderBy(asc(employments.displayName))

    const theirShifts = people.length
      ? await publishedShiftRows(
          tx,
          actor.organizationId,
          and(
            inArray(
              shifts.publishedAssigneeEmploymentId,
              people.map((p) => p.employmentId),
            ),
            inArray(shifts.locationId, [...actor.locationIds]),
            gt(shifts.publishedStartsAt, now),
            lt(shifts.publishedStartsAt, new Date(now.getTime() + 21 * 86_400_000)),
          ),
        )
      : []
    colleagues = people.map((p) => ({
      employmentId: p.employmentId,
      displayName: p.displayName,
      shifts: theirShifts
        .filter((s) => s.assignee === p.employmentId)
        .map((s) => {
          const l = formatShift(s.startsAt!, s.endsAt!, locationsById.get(s.locationId)!.timeZone)
          return { id: s.id, label: `${l.day}, ${l.time}` }
        }),
    }))
  }

  return { shift, isMine: true, started, colleagues }
}

/** The next published shift, for the employee home screen. */
export async function nextShift(tx: Tx, actor: Actor, now = new Date()): Promise<MyShift | null> {
  const locationsById = await loadLocations(tx, actor.organizationId)
  const [row] = await publishedShiftRows(
    tx,
    actor.organizationId,
    and(
      eq(shifts.publishedAssigneeEmploymentId, actor.employmentId),
      gt(shifts.publishedEndsAt, now),
    ),
  )
  if (!row) return null
  return { ...toMyShift(row, locationsById.get(row.locationId)!), swap: null }
}

export interface PersonShift extends Omit<MyShift, 'swap'> {
  onNow: boolean
}

/**
 * Someone's shifts that are on now or still to come, for their profile.
 *
 * PUBLISHED copies only: a draft is not a shift anyone has been told about.
 * Only shifts at locations where the viewer may see the whole schedule are
 * returned; a viewer who can see no schedule anywhere gets null, so the
 * profile leaves the section out rather than showing an empty one.
 */
export async function upcomingShiftsForPerson(
  tx: Tx,
  actor: Actor,
  employmentId: string,
  { limit = 6, now = new Date() }: { limit?: number; now?: Date } = {},
): Promise<PersonShift[] | null> {
  const scope = accessibleLocationIds(actor, 'schedule.view_all')
  if (scope !== null && scope.length === 0) return null
  const rows = await publishedShiftRows(
    tx,
    actor.organizationId,
    and(
      eq(shifts.publishedAssigneeEmploymentId, employmentId),
      gt(shifts.publishedEndsAt, now),
      scope === null ? undefined : inArray(shifts.locationId, scope),
    ),
  )
  const kept = rows.slice(0, limit)
  const locationsById = await loadLocations(tx, actor.organizationId, [
    ...new Set(kept.map((r) => r.locationId)),
  ])
  return kept.flatMap((row) => {
    const location = locationsById.get(row.locationId)
    if (!location || !row.startsAt || !row.endsAt) return []
    return [{ ...toMyShift(row, location), onNow: row.startsAt <= now }]
  })
}
