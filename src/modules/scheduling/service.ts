import { syncOperationsForShifts } from '@/modules/operations/generation'
import { and, asc, eq, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm'
import type { Tx } from '@/server/db'
import { employments, jobRoles, stations } from '@/server/db/schema'
import type { Actor } from '@/server/authz'
import { AUDIT_ACTIONS, recordAuditEvent } from '@/server/audit'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { newId } from '@/lib/ids'
import { addCalendarDays } from '@/lib/dates'
import {
  EXCLUSION_VIOLATION,
  UNIQUE_VIOLATION,
  pgErrorCode,
  requireLocation,
  requireLocationCapability,
  type LocationRef,
} from './access'
import { detectConflicts, hasBlockingConflict, type ScheduleConflict } from './conflicts'
import { diffPublication, hasUnpublishedChange, type PersonChange } from './changes'
import { notifySchedulePeople, type ScheduleNotice } from './notify'
import { conflictShift, listSchedulablePeople, loadConflictPeople } from './people'
import {
  openShiftClaims,
  schedules,
  shiftSwapRequests,
  shiftTemplates,
  shifts,
  timeOffRequests,
} from './schema'
import {
  MINUTES_PER_DAY,
  formatIsoDate,
  formatShift,
  isIsoDate,
  isoWeekday,
  localDateOf,
  localTimeToInstant,
  paidMinutes,
  shiftInstants,
  shiftTimesProblem,
  weekDates,
  weekStartOf,
} from './time'

/*
 * SCHEDULING - THE MANAGER'S SIDE.
 *
 * Templates, the week board, shifts, assignment, and publication.
 * Employee-facing reads live in ./employee.ts; requests (time off, claims,
 * swaps, availability) in ./requests.ts.
 *
 * Every function authorizes against the LOCATION it acts on
 * (./access.ts), validates input against the location's timezone
 * (./time.ts), and asks ./conflicts.ts before anyone is put on a shift.
 */

const NAME_MAX = 80
const NOTES_MAX = 500

function text(value: string | null | undefined, max: number): string {
  return (value ?? '').trim().slice(0, max)
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export interface TemplateView {
  id: string
  locationId: string
  name: string
  jobRoleId: string | null
  jobRoleName: string | null
  stationId: string | null
  stationName: string | null
  startMinute: number
  endMinute: number
  breakMinutes: number
  daysOfWeek: number[]
  headcount: number
  notes: string
  archived: boolean
}

export interface TemplateInput {
  name: string
  jobRoleId: string | null
  stationId: string | null
  startMinute: number
  endMinute: number
  breakMinutes: number
  daysOfWeek: number[]
  headcount: number
  notes: string
}

export async function listTemplates(
  tx: Tx,
  actor: Actor,
  locationId: string,
  options: { includeArchived?: boolean } = {},
): Promise<TemplateView[]> {
  await requireLocationCapability(tx, actor, locationId, 'schedule.view_all')
  const rows = await tx
    .select({
      id: shiftTemplates.id,
      locationId: shiftTemplates.locationId,
      name: shiftTemplates.name,
      jobRoleId: shiftTemplates.jobRoleId,
      jobRoleName: jobRoles.name,
      stationId: shiftTemplates.stationId,
      stationName: stations.name,
      startMinute: shiftTemplates.startMinute,
      endMinute: shiftTemplates.endMinute,
      breakMinutes: shiftTemplates.breakMinutes,
      daysOfWeek: shiftTemplates.daysOfWeek,
      headcount: shiftTemplates.headcount,
      notes: shiftTemplates.notes,
      archivedAt: shiftTemplates.archivedAt,
    })
    .from(shiftTemplates)
    .leftJoin(
      jobRoles,
      and(
        eq(jobRoles.organizationId, shiftTemplates.organizationId),
        eq(jobRoles.id, shiftTemplates.jobRoleId),
      ),
    )
    .leftJoin(
      stations,
      and(
        eq(stations.organizationId, shiftTemplates.organizationId),
        eq(stations.id, shiftTemplates.stationId),
      ),
    )
    .where(
      and(
        eq(shiftTemplates.organizationId, actor.organizationId),
        eq(shiftTemplates.locationId, locationId),
        options.includeArchived ? undefined : isNull(shiftTemplates.archivedAt),
      ),
    )
    .orderBy(asc(shiftTemplates.startMinute), asc(shiftTemplates.name))

  return rows.map(({ archivedAt, ...row }) => ({ ...row, archived: archivedAt !== null }))
}

function templateDuration(startMinute: number, endMinute: number): number {
  return endMinute > startMinute
    ? endMinute - startMinute
    : endMinute + MINUTES_PER_DAY - startMinute
}

async function validateTemplate(
  tx: Tx,
  organizationId: string,
  locationId: string,
  input: TemplateInput,
): Promise<TemplateInput> {
  const errors: Record<string, string[]> = {}
  const name = text(input.name, NAME_MAX + 1)
  if (!name) errors.name = ['Give the template a name.']
  else if (name.length > NAME_MAX) errors.name = [`Keep the name under ${NAME_MAX} characters.`]

  const validMinute = (m: number) => Number.isInteger(m) && m >= 0 && m < MINUTES_PER_DAY
  if (!validMinute(input.startMinute)) errors.startTime = ['Enter a start time.']
  if (!validMinute(input.endMinute)) errors.endTime = ['Enter an end time.']
  if (validMinute(input.startMinute) && input.startMinute === input.endMinute) {
    errors.endTime = ['The end time needs to differ from the start time.']
  }

  const breakMinutes = Number.isInteger(input.breakMinutes) ? input.breakMinutes : -1
  if (breakMinutes < 0 || breakMinutes > 240) {
    errors.breakMinutes = ['A break is between 0 and 240 minutes.']
  } else if (
    validMinute(input.startMinute) &&
    validMinute(input.endMinute) &&
    input.startMinute !== input.endMinute &&
    breakMinutes >= templateDuration(input.startMinute, input.endMinute)
  ) {
    errors.breakMinutes = ['The break is as long as the shift.']
  }

  const days = [...new Set(input.daysOfWeek)].sort()
  if (days.some((d) => !Number.isInteger(d) || d < 1 || d > 7))
    errors.daysOfWeek = ['Pick days of the week.']
  if (!Number.isInteger(input.headcount) || input.headcount < 1 || input.headcount > 20) {
    errors.headcount = ['Between 1 and 20 people.']
  }

  await validateRoleAndStation(
    tx,
    organizationId,
    locationId,
    input.jobRoleId,
    input.stationId,
    errors,
  )

  if (Object.keys(errors).length > 0) {
    throw new ValidationError(errors, 'Check the highlighted fields.')
  }
  return { ...input, name, daysOfWeek: days, breakMinutes, notes: text(input.notes, NOTES_MAX) }
}

async function validateRoleAndStation(
  tx: Tx,
  organizationId: string,
  locationId: string,
  jobRoleId: string | null,
  stationId: string | null,
  errors: Record<string, string[]>,
): Promise<void> {
  if (jobRoleId) {
    const [role] = await tx
      .select({ id: jobRoles.id })
      .from(jobRoles)
      .where(
        and(
          eq(jobRoles.organizationId, organizationId),
          eq(jobRoles.id, jobRoleId),
          isNull(jobRoles.archivedAt),
        ),
      )
      .limit(1)
    if (!role) errors.jobRoleId = ['Choose a job role from the list.']
  }
  if (stationId) {
    const [station] = await tx
      .select({ id: stations.id })
      .from(stations)
      .where(
        and(
          eq(stations.organizationId, organizationId),
          eq(stations.id, stationId),
          eq(stations.locationId, locationId),
          isNull(stations.archivedAt),
        ),
      )
      .limit(1)
    if (!station) errors.stationId = ['Choose a station at this location.']
  }
}

export async function createTemplate(
  tx: Tx,
  actor: Actor,
  locationId: string,
  input: TemplateInput,
): Promise<string> {
  const location = await requireLocationCapability(
    tx,
    actor,
    locationId,
    'schedule.manage_templates',
  )
  const clean = await validateTemplate(tx, actor.organizationId, locationId, input)
  const id = newId()
  try {
    await tx.transaction(async (sp) => {
      await sp.insert(shiftTemplates).values({
        id,
        organizationId: actor.organizationId,
        locationId,
        ...clean,
        createdByEmploymentId: actor.employmentId,
      })
    })
  } catch (error) {
    if (pgErrorCode(error) === UNIQUE_VIOLATION) {
      throw new ValidationError(
        { name: ['A template with this name already exists at this location.'] },
        'That name is taken.',
      )
    }
    throw error
  }
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.SHIFT_TEMPLATE_CREATED,
    summary: `Created the shift template "${clean.name}" at ${location.name}`,
    subjectType: 'shift_template',
    subjectId: id,
    locationId,
  })
  return id
}

async function requireTemplate(tx: Tx, actor: Actor, templateId: string) {
  const [row] = await tx
    .select()
    .from(shiftTemplates)
    .where(
      and(
        eq(shiftTemplates.organizationId, actor.organizationId),
        eq(shiftTemplates.id, templateId),
      ),
    )
    .limit(1)
  if (!row) throw new NotFoundError('Template not found')
  return row
}

export async function updateTemplate(
  tx: Tx,
  actor: Actor,
  templateId: string,
  input: TemplateInput,
): Promise<void> {
  const existing = await requireTemplate(tx, actor, templateId)
  await requireLocationCapability(tx, actor, existing.locationId, 'schedule.manage_templates')
  if (existing.archivedAt) throw new ValidationError({}, 'This template is archived.')
  const clean = await validateTemplate(tx, actor.organizationId, existing.locationId, input)
  try {
    await tx.transaction(async (sp) => {
      await sp
        .update(shiftTemplates)
        .set({ ...clean, updatedAt: new Date() })
        .where(
          and(
            eq(shiftTemplates.organizationId, actor.organizationId),
            eq(shiftTemplates.id, templateId),
          ),
        )
    })
  } catch (error) {
    if (pgErrorCode(error) === UNIQUE_VIOLATION) {
      throw new ValidationError(
        { name: ['A template with this name already exists at this location.'] },
        'That name is taken.',
      )
    }
    throw error
  }
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.SHIFT_TEMPLATE_UPDATED,
    summary: `Updated the shift template "${clean.name}"`,
    subjectType: 'shift_template',
    subjectId: templateId,
    locationId: existing.locationId,
  })
}

export async function archiveTemplate(tx: Tx, actor: Actor, templateId: string): Promise<void> {
  const existing = await requireTemplate(tx, actor, templateId)
  await requireLocationCapability(tx, actor, existing.locationId, 'schedule.manage_templates')
  if (existing.archivedAt) return
  await tx
    .update(shiftTemplates)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(shiftTemplates.organizationId, actor.organizationId),
        eq(shiftTemplates.id, templateId),
      ),
    )
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.SHIFT_TEMPLATE_ARCHIVED,
    summary: `Archived the shift template "${existing.name}". Shifts already made from it are unchanged.`,
    subjectType: 'shift_template',
    subjectId: templateId,
    locationId: existing.locationId,
  })
}

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------

export interface ScheduleSummary {
  id: string
  status: string
  publishedVersion: number
  publishedAt: Date | null
  hasUnpublishedChanges: boolean
}

export function requireWeekStart(weekStart: string): string {
  if (!isIsoDate(weekStart) || isoWeekday(weekStart) !== 1) {
    throw new ValidationError({ weekStart: ['Choose a week.'] }, 'That is not the start of a week.')
  }
  return weekStart
}

async function findSchedule(tx: Tx, organizationId: string, locationId: string, weekStart: string) {
  const [row] = await tx
    .select()
    .from(schedules)
    .where(
      and(
        eq(schedules.organizationId, organizationId),
        eq(schedules.locationId, locationId),
        eq(schedules.weekStart, weekStart),
      ),
    )
    .limit(1)
  return row ?? null
}

export async function ensureSchedule(tx: Tx, actor: Actor, location: LocationRef, weekStart: string) {
  const inserted = await tx
    .insert(schedules)
    .values({
      id: newId(),
      organizationId: actor.organizationId,
      locationId: location.id,
      weekStart,
    })
    .onConflictDoNothing({
      target: [schedules.organizationId, schedules.locationId, schedules.weekStart],
    })
    .returning({ id: schedules.id })
  const schedule = await findSchedule(tx, actor.organizationId, location.id, weekStart)
  if (!schedule) throw new Error('Schedule could not be created')
  if (inserted.length > 0) {
    await recordAuditEvent(tx, actor, {
      action: AUDIT_ACTIONS.SCHEDULE_CREATED,
      summary: `Started the schedule for ${location.name}, week of ${formatIsoDate(weekStart)}`,
      subjectType: 'schedule',
      subjectId: schedule.id,
      locationId: location.id,
    })
  }
  return schedule
}

/** A published schedule now differs from what employees were told. */
export async function markChanged(tx: Tx, organizationId: string, scheduleId: string): Promise<void> {
  await tx
    .update(schedules)
    .set({ hasUnpublishedChanges: true, updatedAt: new Date() })
    .where(
      and(
        eq(schedules.organizationId, organizationId),
        eq(schedules.id, scheduleId),
        eq(schedules.status, 'published'),
      ),
    )
}

// ---------------------------------------------------------------------------
// The week board
// ---------------------------------------------------------------------------

export interface BoardShift {
  id: string
  localDate: string
  startsAt: Date
  endsAt: Date
  day: string
  time: string
  endsNextDay: boolean
  paidMinutes: number
  breakMinutes: number
  notes: string
  jobRoleId: string | null
  jobRoleName: string | null
  stationId: string | null
  stationName: string | null
  templateId: string | null
  assigneeEmploymentId: string | null
  assigneeName: string | null
  isOpen: boolean
  status: string
  version: number
  published: boolean
  unpublishedChange: boolean
  conflicts: ScheduleConflict[]
  pendingClaims: number
  activeSwapStatus: string | null
}

export interface BoardDay {
  date: string
  label: string
  shifts: number
  assigned: number
  open: number
  unassigned: number
  scheduledMinutes: number
  timeOff: { employmentId: string; displayName: string; status: string }[]
}

export interface WeekBoard {
  location: LocationRef
  weekStart: string
  previousWeek: string
  nextWeek: string
  schedule: ScheduleSummary | null
  shifts: BoardShift[]
  days: BoardDay[]
  totals: {
    shifts: number
    assigned: number
    open: number
    unassigned: number
    scheduledMinutes: number
    blocking: number
    warnings: number
    unpublishedChanges: number
  }
  people: {
    employmentId: string
    displayName: string
    jobRoleIds: string[]
    scheduledMinutes: number
  }[]
}

export function weekBounds(location: LocationRef, weekStart: string) {
  const from = localTimeToInstant(weekStart, 0, location.timeZone)
  const to = localTimeToInstant(addCalendarDays(weekStart, 7), 0, location.timeZone)
  if (!from || !to) throw new ValidationError({}, 'That week could not be read at this location.')
  return { from, to }
}

export async function loadWeek(
  tx: Tx,
  actor: Actor,
  locationId: string,
  weekStart: string,
): Promise<WeekBoard> {
  const location = await requireLocationCapability(tx, actor, locationId, 'schedule.view_all')
  requireWeekStart(weekStart)
  const schedule = await findSchedule(tx, actor.organizationId, locationId, weekStart)
  const { from, to } = weekBounds(location, weekStart)

  const rows = schedule ? await boardShiftRows(tx, actor.organizationId, schedule.id) : []
  const assignees = rows.map((r) => r.assigneeEmploymentId).filter((id): id is string => !!id)
  const people = await loadConflictPeople(tx, actor.organizationId, assignees, { from, to })

  const shiftIds = rows.map((r) => r.id)
  const claimCounts = new Map<string, number>()
  const swapStatus = new Map<string, string>()
  if (shiftIds.length > 0) {
    const claims = await tx
      .select({ shiftId: openShiftClaims.shiftId })
      .from(openShiftClaims)
      .where(
        and(
          eq(openShiftClaims.organizationId, actor.organizationId),
          inArray(openShiftClaims.shiftId, shiftIds),
          eq(openShiftClaims.status, 'pending'),
        ),
      )
    for (const c of claims) claimCounts.set(c.shiftId, (claimCounts.get(c.shiftId) ?? 0) + 1)

    const swaps = await tx
      .select({
        shiftId: shiftSwapRequests.shiftId,
        recipientShiftId: shiftSwapRequests.recipientShiftId,
        status: shiftSwapRequests.status,
      })
      .from(shiftSwapRequests)
      .where(
        and(
          eq(shiftSwapRequests.organizationId, actor.organizationId),
          inArray(shiftSwapRequests.status, ['pending_recipient', 'pending_manager']),
          or(
            inArray(shiftSwapRequests.shiftId, shiftIds),
            inArray(shiftSwapRequests.recipientShiftId, shiftIds),
          ),
        ),
      )
    for (const s of swaps) {
      swapStatus.set(s.shiftId, s.status)
      if (s.recipientShiftId) swapStatus.set(s.recipientShiftId, s.status)
    }
  }

  const boardShifts: BoardShift[] = rows.map((row) => {
    const label = formatShift(row.startsAt, row.endsAt, location.timeZone)
    const person = row.assigneeEmploymentId ? people.get(row.assigneeEmploymentId) : undefined
    const conflicts =
      row.status === 'active' && person
        ? detectConflicts(conflictShift(row, location.timeZone), person)
        : []
    return {
      id: row.id,
      localDate: localDateOf(row.startsAt, location.timeZone),
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      day: label.day,
      time: label.time,
      endsNextDay: label.endsNextDay,
      paidMinutes: paidMinutes(row.startsAt, row.endsAt, row.breakMinutes),
      breakMinutes: row.breakMinutes,
      notes: row.notes,
      jobRoleId: row.jobRoleId,
      jobRoleName: row.jobRoleName,
      stationId: row.stationId,
      stationName: row.stationName,
      templateId: row.templateId,
      assigneeEmploymentId: row.assigneeEmploymentId,
      assigneeName: row.assigneeName,
      isOpen: row.isOpen,
      status: row.status,
      version: row.version,
      published: row.publishedAt !== null,
      unpublishedChange: schedule?.status === 'published' && hasUnpublishedChange(row),
      conflicts,
      pendingClaims: claimCounts.get(row.id) ?? 0,
      activeSwapStatus: swapStatus.get(row.id) ?? null,
    }
  })

  const active = boardShifts.filter((s) => s.status === 'active')
  const schedulable = await listSchedulablePeople(tx, actor.organizationId, locationId)
  const timeOff = await timeOffDuring(
    tx,
    actor.organizationId,
    schedulable.map((p) => p.employmentId),
    weekStart,
  )

  const days: BoardDay[] = weekDates(weekStart).map((date) => {
    const onDay = active.filter((s) => s.localDate === date)
    return {
      date,
      label: formatIsoDate(date),
      shifts: onDay.length,
      assigned: onDay.filter((s) => s.assigneeEmploymentId).length,
      open: onDay.filter((s) => s.isOpen).length,
      unassigned: onDay.filter((s) => !s.assigneeEmploymentId && !s.isOpen).length,
      scheduledMinutes: onDay.reduce((sum, s) => sum + s.paidMinutes, 0),
      timeOff: timeOff
        .filter((t) => t.startsOn <= date && t.endsOn >= date)
        .map((t) => ({
          employmentId: t.employmentId,
          displayName:
            schedulable.find((p) => p.employmentId === t.employmentId)?.displayName ?? '',
          status: t.status,
        })),
    }
  })

  const conflictList = active.flatMap((s) => s.conflicts)
  return {
    location,
    weekStart,
    previousWeek: addCalendarDays(weekStart, -7),
    nextWeek: addCalendarDays(weekStart, 7),
    schedule: schedule
      ? {
          id: schedule.id,
          status: schedule.status,
          publishedVersion: schedule.publishedVersion,
          publishedAt: schedule.publishedAt,
          hasUnpublishedChanges: boardShifts.some((s) => s.unpublishedChange),
        }
      : null,
    shifts: boardShifts,
    days,
    totals: {
      shifts: active.length,
      assigned: active.filter((s) => s.assigneeEmploymentId).length,
      open: active.filter((s) => s.isOpen).length,
      unassigned: active.filter((s) => !s.assigneeEmploymentId && !s.isOpen).length,
      scheduledMinutes: active.reduce((sum, s) => sum + s.paidMinutes, 0),
      blocking: conflictList.filter((c) => c.severity === 'block').length,
      warnings: conflictList.filter((c) => c.severity === 'warn').length,
      unpublishedChanges: boardShifts.filter((s) => s.unpublishedChange).length,
    },
    people: schedulable.map((p) => ({
      employmentId: p.employmentId,
      displayName: p.displayName,
      jobRoleIds: p.jobRoleIds,
      scheduledMinutes: active
        .filter((s) => s.assigneeEmploymentId === p.employmentId)
        .reduce((sum, s) => sum + s.paidMinutes, 0),
    })),
  }
}

async function boardShiftRows(tx: Tx, organizationId: string, scheduleId: string) {
  return tx
    .select({
      id: shifts.id,
      locationId: shifts.locationId,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      breakMinutes: shifts.breakMinutes,
      notes: shifts.notes,
      jobRoleId: shifts.jobRoleId,
      jobRoleName: jobRoles.name,
      stationId: shifts.stationId,
      stationName: stations.name,
      templateId: shifts.templateId,
      assigneeEmploymentId: shifts.assigneeEmploymentId,
      assigneeName: employments.displayName,
      isOpen: shifts.isOpen,
      status: shifts.status,
      version: shifts.version,
      publishedAt: shifts.publishedAt,
      publishedStatus: shifts.publishedStatus,
      publishedAssigneeEmploymentId: shifts.publishedAssigneeEmploymentId,
      publishedIsOpen: shifts.publishedIsOpen,
      publishedStartsAt: shifts.publishedStartsAt,
      publishedEndsAt: shifts.publishedEndsAt,
      publishedBreakMinutes: shifts.publishedBreakMinutes,
      publishedJobRoleId: shifts.publishedJobRoleId,
      publishedStationId: shifts.publishedStationId,
      publishedNotes: shifts.publishedNotes,
    })
    .from(shifts)
    .leftJoin(
      jobRoles,
      and(eq(jobRoles.organizationId, shifts.organizationId), eq(jobRoles.id, shifts.jobRoleId)),
    )
    .leftJoin(
      stations,
      and(eq(stations.organizationId, shifts.organizationId), eq(stations.id, shifts.stationId)),
    )
    .leftJoin(
      employments,
      and(
        eq(employments.organizationId, shifts.organizationId),
        eq(employments.id, shifts.assigneeEmploymentId),
      ),
    )
    .where(
      and(
        eq(shifts.organizationId, organizationId),
        eq(shifts.scheduleId, scheduleId),
        // Cancelled shifts stay on the board until the cancellation is published.
        or(eq(shifts.status, 'active'), eq(shifts.publishedStatus, 'active')),
      ),
    )
    .orderBy(asc(shifts.startsAt), asc(jobRoles.name))
}

async function timeOffDuring(
  tx: Tx,
  organizationId: string,
  employmentIds: string[],
  weekStart: string,
) {
  if (employmentIds.length === 0) return []
  return tx
    .select({
      employmentId: timeOffRequests.employmentId,
      startsOn: timeOffRequests.startsOn,
      endsOn: timeOffRequests.endsOn,
      status: timeOffRequests.status,
    })
    .from(timeOffRequests)
    .where(
      and(
        eq(timeOffRequests.organizationId, organizationId),
        inArray(timeOffRequests.employmentId, employmentIds),
        inArray(timeOffRequests.status, ['pending', 'approved']),
        lte(timeOffRequests.startsOn, addCalendarDays(weekStart, 6)),
        gte(timeOffRequests.endsOn, weekStart),
      ),
    )
}

// ---------------------------------------------------------------------------
// Shifts
// ---------------------------------------------------------------------------

export interface ShiftInput {
  date: string
  startMinute: number
  endMinute: number
  breakMinutes: number
  jobRoleId: string | null
  stationId: string | null
  notes: string
  assigneeEmploymentId: string | null
  templateId?: string | null
}

export interface ShiftResult {
  id: string
  warnings: string[]
}

type ShiftRow = typeof shifts.$inferSelect

export async function requireShift(
  tx: Tx,
  organizationId: string,
  shiftId: string,
): Promise<ShiftRow> {
  const [row] = await tx
    .select()
    .from(shifts)
    .where(and(eq(shifts.organizationId, organizationId), eq(shifts.id, shiftId)))
    .limit(1)
  if (!row) throw new NotFoundError('Shift not found')
  return row
}

/** A shift the actor may manage with `capability`. Outside scope reads as not found. */
async function requireManagedShift(
  tx: Tx,
  actor: Actor,
  shiftId: string,
  capability: Parameters<typeof requireLocationCapability>[3],
) {
  const shift = await requireShift(tx, actor.organizationId, shiftId)
  const location = await requireLocationCapability(tx, actor, shift.locationId, capability)
  return { shift, location }
}

async function validateShiftInput(
  tx: Tx,
  organizationId: string,
  location: LocationRef,
  input: ShiftInput,
) {
  const errors: Record<string, string[]> = {}
  const times = shiftInstants(input.date, input.startMinute, input.endMinute, location.timeZone)
  if (!times.ok) {
    const field =
      times.reason === 'nonexistent_end'
        ? 'endTime'
        : times.reason === 'invalid'
          ? 'date'
          : 'startTime'
    errors[field] = [shiftTimesProblem(times.reason)]
  }
  const breakMinutes = Number.isInteger(input.breakMinutes) ? input.breakMinutes : -1
  if (breakMinutes < 0 || breakMinutes > 240)
    errors.breakMinutes = ['A break is between 0 and 240 minutes.']
  else if (times.ok && breakMinutes >= paidMinutes(times.startsAt, times.endsAt, 0)) {
    errors.breakMinutes = ['The break is as long as the shift.']
  }
  await validateRoleAndStation(
    tx,
    organizationId,
    location.id,
    input.jobRoleId,
    input.stationId,
    errors,
  )
  if (Object.keys(errors).length > 0 || !times.ok) {
    throw new ValidationError(errors, 'Check the highlighted fields.')
  }
  return {
    startsAt: times.startsAt,
    endsAt: times.endsAt,
    breakMinutes,
    notes: text(input.notes, NOTES_MAX),
  }
}

/**
 * Conflicts for putting `employmentId` on a shift. Blocking conflicts throw;
 * warnings are returned for the manager to see.
 */
async function assertAssignable(
  tx: Tx,
  organizationId: string,
  location: LocationRef,
  shift: {
    id: string | null
    startsAt: Date
    endsAt: Date
    breakMinutes: number
    jobRoleId: string | null
  },
  employmentId: string,
): Promise<string[]> {
  const people = await loadConflictPeople(tx, organizationId, [employmentId], {
    from: shift.startsAt,
    to: shift.endsAt,
  })
  const person = people.get(employmentId)
  if (!person)
    throw new ValidationError(
      { assigneeEmploymentId: ['Choose someone from the list.'] },
      'That person was not found.',
    )
  const conflicts = detectConflicts(
    conflictShift({ ...shift, locationId: location.id }, location.timeZone),
    person,
  )
  if (hasBlockingConflict(conflicts)) {
    const messages = conflicts.filter((c) => c.severity === 'block').map((c) => c.message)
    throw new ValidationError(
      { assigneeEmploymentId: messages },
      messages[0] ?? 'That person cannot take this shift.',
    )
  }
  return conflicts.map((c) => c.message)
}

function exclusionToValidation(error: unknown): never {
  if (pgErrorCode(error) === EXCLUSION_VIOLATION) {
    throw new ValidationError(
      { assigneeEmploymentId: ['They already have a shift at that time.'] },
      'That person is already on a shift that overlaps this one.',
    )
  }
  throw error
}

export async function createShift(
  tx: Tx,
  actor: Actor,
  locationId: string,
  input: ShiftInput,
): Promise<ShiftResult> {
  const location = await requireLocationCapability(tx, actor, locationId, 'schedule.draft')
  const clean = await validateShiftInput(tx, actor.organizationId, location, input)
  const weekStart = weekStartOf(input.date)

  const warnings = input.assigneeEmploymentId
    ? await assertAssignable(
        tx,
        actor.organizationId,
        location,
        { id: null, ...clean, jobRoleId: input.jobRoleId },
        input.assigneeEmploymentId,
      )
    : []

  let templateId: string | null = null
  if (input.templateId) {
    const template = await requireTemplate(tx, actor, input.templateId)
    if (template.locationId !== locationId) throw new NotFoundError('Template not found')
    templateId = template.id
  }

  const schedule = await ensureSchedule(tx, actor, location, weekStart)
  const id = newId()
  try {
    await tx.transaction(async (sp) => {
      await sp.insert(shifts).values({
        id,
        organizationId: actor.organizationId,
        scheduleId: schedule.id,
        locationId,
        templateId,
        jobRoleId: input.jobRoleId,
        stationId: input.stationId,
        ...clean,
        assigneeEmploymentId: input.assigneeEmploymentId,
        createdByEmploymentId: actor.employmentId,
        updatedByEmploymentId: actor.employmentId,
      })
    })
  } catch (error) {
    exclusionToValidation(error)
  }
  await markChanged(tx, actor.organizationId, schedule.id)

  const label = formatShift(clean.startsAt, clean.endsAt, location.timeZone)
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.SHIFT_CREATED,
    summary: `Added a shift on ${label.day}, ${label.time} at ${location.name}`,
    subjectType: 'shift',
    subjectId: id,
    locationId,
    metadata: { assigned: input.assigneeEmploymentId !== null, warnings: warnings.length },
  })
  return { id, warnings }
}

export interface ShiftUpdate {
  date: string
  startMinute: number
  endMinute: number
  breakMinutes: number
  jobRoleId: string | null
  stationId: string | null
  notes: string
}

export async function updateShift(
  tx: Tx,
  actor: Actor,
  shiftId: string,
  input: ShiftUpdate,
): Promise<ShiftResult> {
  const { shift, location } = await requireManagedShift(tx, actor, shiftId, 'schedule.draft')
  if (shift.status !== 'active') throw new ValidationError({}, 'This shift has been cancelled.')

  const [schedule] = await tx
    .select({ weekStart: schedules.weekStart })
    .from(schedules)
    .where(
      and(eq(schedules.organizationId, actor.organizationId), eq(schedules.id, shift.scheduleId)),
    )
  if (!schedule || weekStartOf(input.date) !== schedule.weekStart) {
    throw new ValidationError(
      { date: ['Keep the shift in the same week, or add a new one in the other week.'] },
      'A shift stays in its own week.',
    )
  }

  const clean = await validateShiftInput(tx, actor.organizationId, location, {
    ...input,
    assigneeEmploymentId: shift.assigneeEmploymentId,
  })
  const warnings = shift.assigneeEmploymentId
    ? await assertAssignable(
        tx,
        actor.organizationId,
        location,
        { id: shift.id, ...clean, jobRoleId: input.jobRoleId },
        shift.assigneeEmploymentId,
      )
    : []

  try {
    await tx.transaction(async (sp) => {
      await sp
        .update(shifts)
        .set({
          ...clean,
          jobRoleId: input.jobRoleId,
          stationId: input.stationId,
          version: sql`${shifts.version} + 1`,
          updatedByEmploymentId: actor.employmentId,
          updatedAt: new Date(),
        })
        .where(and(eq(shifts.organizationId, actor.organizationId), eq(shifts.id, shiftId)))
    })
  } catch (error) {
    exclusionToValidation(error)
  }
  await markChanged(tx, actor.organizationId, shift.scheduleId)

  const before = formatShift(shift.startsAt, shift.endsAt, location.timeZone)
  const after = formatShift(clean.startsAt, clean.endsAt, location.timeZone)
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.SHIFT_UPDATED,
    summary:
      before.day === after.day && before.time === after.time
        ? `Edited the details of the shift on ${after.day}, ${after.time}`
        : `Moved a shift from ${before.day}, ${before.time} to ${after.day}, ${after.time}`,
    subjectType: 'shift',
    subjectId: shiftId,
    locationId: location.id,
    metadata: { published: shift.publishedAt !== null },
  })
  return { id: shiftId, warnings }
}

export async function assignShift(
  tx: Tx,
  actor: Actor,
  shiftId: string,
  employmentId: string | null,
): Promise<ShiftResult> {
  const { shift, location } = await requireManagedShift(tx, actor, shiftId, 'schedule.draft')
  if (shift.status !== 'active') throw new ValidationError({}, 'This shift has been cancelled.')
  if (shift.assigneeEmploymentId === employmentId) return { id: shiftId, warnings: [] }

  const warnings = employmentId
    ? await assertAssignable(tx, actor.organizationId, location, shift, employmentId)
    : []

  try {
    await tx.transaction(async (sp) => {
      await sp
        .update(shifts)
        .set({
          assigneeEmploymentId: employmentId,
          isOpen: false,
          version: sql`${shifts.version} + 1`,
          updatedByEmploymentId: actor.employmentId,
          updatedAt: new Date(),
        })
        .where(and(eq(shifts.organizationId, actor.organizationId), eq(shifts.id, shiftId)))
    })
  } catch (error) {
    exclusionToValidation(error)
  }

  // Anyone still waiting on this shift is told it was filled another way.
  if (employmentId) {
    await tx
      .update(openShiftClaims)
      .set({
        status: 'declined',
        decidedByEmploymentId: actor.employmentId,
        decidedAt: new Date(),
        decisionNote: 'A manager assigned this shift directly.',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(openShiftClaims.organizationId, actor.organizationId),
          eq(openShiftClaims.shiftId, shiftId),
          eq(openShiftClaims.status, 'pending'),
        ),
      )
  }
  await cancelActiveSwaps(tx, actor, [shiftId], 'The shift was reassigned by a manager.')
  await markChanged(tx, actor.organizationId, shift.scheduleId)

  const names = await displayNames(tx, actor.organizationId, [
    employmentId,
    shift.assigneeEmploymentId,
  ])
  const label = formatShift(shift.startsAt, shift.endsAt, location.timeZone)
  await recordAuditEvent(tx, actor, {
    action: employmentId ? AUDIT_ACTIONS.SHIFT_ASSIGNED : AUDIT_ACTIONS.SHIFT_UNASSIGNED,
    summary: employmentId
      ? `Assigned ${names.get(employmentId) ?? 'someone'} to ${label.day}, ${label.time}${
          shift.assigneeEmploymentId
            ? ` (was ${names.get(shift.assigneeEmploymentId) ?? 'someone else'})`
            : ''
        }`
      : `Removed ${names.get(shift.assigneeEmploymentId ?? '') ?? 'the assignee'} from ${label.day}, ${label.time}`,
    subjectType: 'shift',
    subjectId: shiftId,
    locationId: location.id,
    metadata: { warnings: warnings.length, published: shift.publishedAt !== null },
  })
  return { id: shiftId, warnings }
}

/** Offer an unassigned shift for people to claim, or withdraw the offer. */
export async function setShiftOpen(
  tx: Tx,
  actor: Actor,
  shiftId: string,
  open: boolean,
): Promise<void> {
  const { shift, location } = await requireManagedShift(tx, actor, shiftId, 'openshift.manage')
  if (shift.status !== 'active') throw new ValidationError({}, 'This shift has been cancelled.')
  if (open && shift.assigneeEmploymentId) {
    throw new ValidationError(
      {},
      'Remove the assigned person before offering this shift to others.',
    )
  }
  if (shift.isOpen === open) return

  await tx
    .update(shifts)
    .set({
      isOpen: open,
      version: sql`${shifts.version} + 1`,
      updatedByEmploymentId: actor.employmentId,
      updatedAt: new Date(),
    })
    .where(and(eq(shifts.organizationId, actor.organizationId), eq(shifts.id, shiftId)))

  if (!open) {
    await tx
      .update(openShiftClaims)
      .set({
        status: 'expired',
        decisionNote: 'The shift is no longer offered.',
        decidedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(openShiftClaims.organizationId, actor.organizationId),
          eq(openShiftClaims.shiftId, shiftId),
          eq(openShiftClaims.status, 'pending'),
        ),
      )
  }
  await markChanged(tx, actor.organizationId, shift.scheduleId)

  const label = formatShift(shift.startsAt, shift.endsAt, location.timeZone)
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.SHIFT_OPENED,
    summary: open
      ? `Offered the shift on ${label.day}, ${label.time} as an open shift`
      : `Stopped offering the shift on ${label.day}, ${label.time}`,
    subjectType: 'shift',
    subjectId: shiftId,
    locationId: location.id,
    metadata: { open },
  })
}

/**
 * Remove a shift. Never published: deleted outright, nobody was told about
 * it. Published: cancelled, so the next publication tells the person it is
 * gone and the record of what they were told survives.
 */
export async function cancelShift(
  tx: Tx,
  actor: Actor,
  shiftId: string,
): Promise<'deleted' | 'cancelled'> {
  const { shift, location } = await requireManagedShift(tx, actor, shiftId, 'schedule.draft')
  const label = formatShift(shift.startsAt, shift.endsAt, location.timeZone)

  if (shift.publishedAt === null) {
    await tx
      .delete(shifts)
      .where(and(eq(shifts.organizationId, actor.organizationId), eq(shifts.id, shiftId)))
    await recordAuditEvent(tx, actor, {
      action: AUDIT_ACTIONS.SHIFT_DELETED,
      summary: `Deleted an unpublished shift on ${label.day}, ${label.time}`,
      subjectType: 'shift',
      subjectId: shiftId,
      locationId: location.id,
    })
    return 'deleted'
  }

  if (shift.status === 'cancelled') return 'cancelled'
  await tx
    .update(shifts)
    .set({
      status: 'cancelled',
      isOpen: false,
      version: sql`${shifts.version} + 1`,
      updatedByEmploymentId: actor.employmentId,
      updatedAt: new Date(),
    })
    .where(and(eq(shifts.organizationId, actor.organizationId), eq(shifts.id, shiftId)))
  await tx
    .update(openShiftClaims)
    .set({
      status: 'expired',
      decisionNote: 'The shift was cancelled.',
      decidedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(openShiftClaims.organizationId, actor.organizationId),
        eq(openShiftClaims.shiftId, shiftId),
        eq(openShiftClaims.status, 'pending'),
      ),
    )
  await cancelActiveSwaps(tx, actor, [shiftId], 'The shift was cancelled.')
  await markChanged(tx, actor.organizationId, shift.scheduleId)
  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.SHIFT_CANCELLED,
    summary: `Cancelled the shift on ${label.day}, ${label.time}. The assignee is told when the change is published.`,
    subjectType: 'shift',
    subjectId: shiftId,
    locationId: location.id,
  })
  return 'cancelled'
}

/** Close any swap still in progress for these shifts. */
export async function cancelActiveSwaps(
  tx: Tx,
  actor: Actor,
  shiftIds: string[],
  reason: string,
): Promise<number> {
  if (shiftIds.length === 0) return 0
  const rows = await tx
    .update(shiftSwapRequests)
    .set({ status: 'expired', decisionNote: reason, decidedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(shiftSwapRequests.organizationId, actor.organizationId),
        inArray(shiftSwapRequests.status, ['pending_recipient', 'pending_manager']),
        or(
          inArray(shiftSwapRequests.shiftId, shiftIds),
          inArray(shiftSwapRequests.recipientShiftId, shiftIds),
        ),
      ),
    )
    .returning({ id: shiftSwapRequests.id })
  return rows.length
}

/**
 * Create the week's shifts from templates. Idempotent: a template that
 * already has its headcount of shifts on a date gets no more.
 */
export async function applyTemplates(
  tx: Tx,
  actor: Actor,
  locationId: string,
  weekStart: string,
  templateIds?: readonly string[],
): Promise<{ created: number }> {
  const location = await requireLocationCapability(tx, actor, locationId, 'schedule.draft')
  requireWeekStart(weekStart)
  const templates = (await listTemplates(tx, actor, locationId)).filter(
    (t) => !templateIds || templateIds.includes(t.id),
  )
  if (templates.length === 0) return { created: 0 }

  const schedule = await ensureSchedule(tx, actor, location, weekStart)
  const existing = await tx
    .select({ templateId: shifts.templateId, startsAt: shifts.startsAt })
    .from(shifts)
    .where(
      and(
        eq(shifts.organizationId, actor.organizationId),
        eq(shifts.scheduleId, schedule.id),
        eq(shifts.status, 'active'),
      ),
    )

  let created = 0
  for (const template of templates) {
    for (const date of weekDates(weekStart)) {
      if (!template.daysOfWeek.includes(isoWeekday(date))) continue
      const times = shiftInstants(date, template.startMinute, template.endMinute, location.timeZone)
      // A pattern time that does not exist on a clock-change date is skipped, not moved.
      if (!times.ok) continue
      const already = existing.filter(
        (s) => s.templateId === template.id && localDateOf(s.startsAt, location.timeZone) === date,
      ).length
      for (let i = already; i < template.headcount; i += 1) {
        await tx.insert(shifts).values({
          id: newId(),
          organizationId: actor.organizationId,
          scheduleId: schedule.id,
          locationId,
          templateId: template.id,
          jobRoleId: template.jobRoleId,
          stationId: template.stationId,
          startsAt: times.startsAt,
          endsAt: times.endsAt,
          breakMinutes: template.breakMinutes,
          notes: template.notes,
          createdByEmploymentId: actor.employmentId,
          updatedByEmploymentId: actor.employmentId,
        })
        created += 1
      }
    }
  }

  if (created > 0) {
    await markChanged(tx, actor.organizationId, schedule.id)
    await recordAuditEvent(tx, actor, {
      action: AUDIT_ACTIONS.SHIFT_TEMPLATE_APPLIED,
      summary: `Added ${created} ${created === 1 ? 'shift' : 'shifts'} from templates to ${location.name}, week of ${formatIsoDate(weekStart)}`,
      subjectType: 'schedule',
      subjectId: schedule.id,
      locationId,
      metadata: { created, templates: templates.length },
    })
  }
  return { created }
}

// ---------------------------------------------------------------------------
// Publication
// ---------------------------------------------------------------------------

export interface PublicationPreview {
  scheduleId: string
  firstPublication: boolean
  blocking: { shiftId: string; label: string; messages: string[] }[]
  warnings: number
  unassigned: number
  changedShifts: number
  people: { employmentId: string; displayName: string; changes: string[] }[]
}

async function requireSchedule(tx: Tx, organizationId: string, scheduleId: string) {
  const [row] = await tx
    .select()
    .from(schedules)
    .where(and(eq(schedules.organizationId, organizationId), eq(schedules.id, scheduleId)))
    .limit(1)
  if (!row) throw new NotFoundError('Schedule not found')
  return row
}

function describeChange(change: PersonChange, timeZone: string): string {
  const now = formatShift(change.startsAt, change.endsAt, timeZone)
  if (change.kind === 'added') return `Added: ${now.day}, ${now.time}`
  if (change.kind === 'removed') return `Removed: ${now.day}, ${now.time}`
  if (change.previousStartsAt && change.previousEndsAt) {
    const before = formatShift(change.previousStartsAt, change.previousEndsAt, timeZone)
    if (before.day !== now.day || before.time !== now.time) {
      return `Changed: ${before.day}, ${before.time} is now ${now.day}, ${now.time}`
    }
  }
  return `Updated details: ${now.day}, ${now.time}`
}

async function publicationState(tx: Tx, actor: Actor, scheduleId: string) {
  const schedule = await requireSchedule(tx, actor.organizationId, scheduleId)
  const location = await requireLocation(tx, actor.organizationId, schedule.locationId)
  const rows = await tx
    .select()
    .from(shifts)
    .where(and(eq(shifts.organizationId, actor.organizationId), eq(shifts.scheduleId, scheduleId)))
    .orderBy(asc(shifts.startsAt))
  const assignees = rows
    .filter((r) => r.status === 'active' && r.assigneeEmploymentId)
    .map((r) => r.assigneeEmploymentId!)
  const { from, to } = weekBounds(location, schedule.weekStart)
  const people = await loadConflictPeople(tx, actor.organizationId, assignees, { from, to })
  const blocking = rows
    .filter((r) => r.status === 'active' && r.assigneeEmploymentId)
    .map((r) => {
      const conflicts = detectConflicts(
        conflictShift(r, location.timeZone),
        people.get(r.assigneeEmploymentId!)!,
      )
      const label = formatShift(r.startsAt, r.endsAt, location.timeZone)
      return {
        shiftId: r.id,
        label: `${label.day}, ${label.time}`,
        messages: conflicts.filter((c) => c.severity === 'block').map((c) => c.message),
        warnings: conflicts.filter((c) => c.severity === 'warn').length,
      }
    })
  return { schedule, location, rows, blocking, diff: diffPublication(rows) }
}

export async function previewPublication(
  tx: Tx,
  actor: Actor,
  scheduleId: string,
): Promise<PublicationPreview> {
  const schedule = await requireSchedule(tx, actor.organizationId, scheduleId)
  await requireLocationCapability(tx, actor, schedule.locationId, 'schedule.view_all')
  const state = await publicationState(tx, actor, scheduleId)
  const names = await displayNames(tx, actor.organizationId, [...state.diff.people.keys()])
  return {
    scheduleId,
    firstPublication: state.schedule.publishedVersion === 0,
    blocking: state.blocking
      .filter((b) => b.messages.length > 0)
      .map(({ warnings: _w, ...b }) => b),
    warnings: state.blocking.reduce((sum, b) => sum + b.warnings, 0),
    unassigned: state.rows.filter(
      (r) => r.status === 'active' && !r.assigneeEmploymentId && !r.isOpen,
    ).length,
    changedShifts: state.diff.changedShiftCount,
    people: [...state.diff.people.entries()]
      .map(([employmentId, changes]) => ({
        employmentId,
        displayName: names.get(employmentId) ?? 'Someone',
        changes: changes.map((c) => describeChange(c, state.location.timeZone)),
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
  }
}

export interface PublicationResult {
  version: number
  notifiedPeople: number
  changedShifts: number
  openShiftNotices: number
}

/**
 * Publish a week: copy the live shifts over what employees were last told,
 * and notify exactly the people whose shifts changed.
 *
 * Refused while any assigned shift has a BLOCKING conflict - nobody is told
 * to work a shift they cannot work. Locks the schedule row, so two managers
 * pressing Publish together produce one version, not two.
 */
export async function publishSchedule(
  tx: Tx,
  actor: Actor,
  scheduleId: string,
  now = new Date(),
): Promise<PublicationResult> {
  const unlocked = await requireSchedule(tx, actor.organizationId, scheduleId)
  await requireLocationCapability(tx, actor, unlocked.locationId, 'schedule.publish')

  await tx
    .select({ id: schedules.id })
    .from(schedules)
    .where(and(eq(schedules.organizationId, actor.organizationId), eq(schedules.id, scheduleId)))
    .for('update')

  const state = await publicationState(tx, actor, scheduleId)
  const blocked = state.blocking.filter((b) => b.messages.length > 0)
  if (blocked.length > 0) {
    throw new ValidationError(
      { schedule: blocked.map((b) => `${b.label}: ${b.messages[0]}`) },
      `${blocked.length} ${blocked.length === 1 ? 'shift has a conflict' : 'shifts have conflicts'} to fix before this can be published.`,
    )
  }
  if (state.schedule.status === 'published' && state.diff.changedShiftCount === 0) {
    throw new ValidationError({}, 'Nothing has changed since this schedule was last published.')
  }
  if (
    state.rows.filter((r) => r.status === 'active').length === 0 &&
    state.schedule.publishedVersion === 0
  ) {
    throw new ValidationError({}, 'Add at least one shift before publishing.')
  }

  const version = state.schedule.publishedVersion + 1
  const nowIso = now.toISOString()
  await tx
    .update(shifts)
    .set({
      publishedAt: sql`coalesce(${shifts.publishedAt}, ${nowIso}::timestamptz)`,
      publishedStartsAt: sql`${shifts.startsAt}`,
      publishedEndsAt: sql`${shifts.endsAt}`,
      publishedBreakMinutes: sql`${shifts.breakMinutes}`,
      publishedJobRoleId: sql`${shifts.jobRoleId}`,
      publishedStationId: sql`${shifts.stationId}`,
      publishedNotes: sql`${shifts.notes}`,
      publishedAssigneeEmploymentId: sql`${shifts.assigneeEmploymentId}`,
      publishedIsOpen: sql`${shifts.isOpen}`,
      publishedStatus: sql`${shifts.status}`,
    })
    .where(and(eq(shifts.organizationId, actor.organizationId), eq(shifts.scheduleId, scheduleId)))

  await tx
    .update(schedules)
    .set({
      status: 'published',
      publishedVersion: version,
      publishedAt: now,
      publishedByEmploymentId: actor.employmentId,
      hasUnpublishedChanges: false,
      updatedAt: now,
    })
    .where(and(eq(schedules.organizationId, actor.organizationId), eq(schedules.id, scheduleId)))

  // The work on each shift follows what was just published: new shifts get
  // their tasks, cancelled ones retire theirs, changed hands move them.
  const operations = await syncOperationsForShifts(
    tx,
    actor.organizationId,
    state.rows.map((r) => r.id),
    actor.employmentId,
    now,
  )

  const { location, diff } = state
  const weekLabel = formatIsoDate(state.schedule.weekStart)
  const href = `/my/schedule?week=${state.schedule.weekStart}`
  const notices: ScheduleNotice[] = [...diff.people.entries()].map(([employmentId, changes]) => {
    const onlyAdded = changes.every((c) => c.kind === 'added')
    return {
      employmentId,
      subjectType: 'schedule',
      subjectId: scheduleId,
      title:
        version === 1 || (onlyAdded && state.schedule.publishedVersion === 0)
          ? `Your ${location.name} schedule for the week of ${weekLabel} is ready`
          : `Your ${location.name} schedule changed for the week of ${weekLabel}`,
      preview: changes.map((c) => describeChange(c, location.timeZone)).join(' · '),
      href,
      purpose: `v${version}`,
    }
  })

  // Newly offered open shifts go to the people who could actually take them.
  let openShiftNotices = 0
  if (diff.newlyOpenShiftIds.length > 0) {
    const candidates = await listSchedulablePeople(tx, actor.organizationId, location.id)
    const openRows = state.rows.filter((r) => diff.newlyOpenShiftIds.includes(r.id))
    const { from, to } = weekBounds(location, state.schedule.weekStart)
    const context = await loadConflictPeople(
      tx,
      actor.organizationId,
      candidates.map((c) => c.employmentId),
      { from, to },
    )
    for (const row of openRows) {
      const label = formatShift(row.startsAt, row.endsAt, location.timeZone)
      for (const candidate of candidates) {
        if (row.jobRoleId && !candidate.jobRoleIds.includes(row.jobRoleId)) continue
        const person = context.get(candidate.employmentId)
        if (
          !person ||
          hasBlockingConflict(detectConflicts(conflictShift(row, location.timeZone), person))
        )
          continue
        notices.push({
          employmentId: candidate.employmentId,
          subjectType: 'shift',
          subjectId: row.id,
          title: `Open shift at ${location.name}: ${label.day}, ${label.time}`,
          preview: 'Ask for it in EverCalm. A manager confirms who gets it.',
          href: '/my/schedule#open-shifts',
          purpose: `open-v${version}`,
        })
        openShiftNotices += 1
      }
    }
  }

  await notifySchedulePeople(tx, actor.organizationId, notices, now)

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.SCHEDULE_PUBLISHED,
    summary:
      version === 1
        ? `Published the ${location.name} schedule for the week of ${weekLabel} to ${diff.people.size} ${diff.people.size === 1 ? 'person' : 'people'}`
        : `Published ${diff.changedShiftCount} ${diff.changedShiftCount === 1 ? 'change' : 'changes'} to the ${location.name} schedule for the week of ${weekLabel}, notifying ${diff.people.size} ${diff.people.size === 1 ? 'person' : 'people'}`,
    subjectType: 'schedule',
    subjectId: scheduleId,
    locationId: location.id,
    metadata: {
      version,
      changedShifts: diff.changedShiftCount,
      notifiedPeople: diff.people.size,
      openShiftNotices,
    },
  })
  if (
    operations.created + operations.cancelled + operations.reassigned + operations.rescheduled >
    0
  ) {
    await recordAuditEvent(tx, actor, {
      action: AUDIT_ACTIONS.OPS_RUNS_GENERATED,
      summary: `Updated shift work for the ${location.name} schedule for the week of ${weekLabel}: ${operations.created} new, ${operations.cancelled} cancelled, ${operations.reassigned} changed hands, ${operations.rescheduled} retimed`,
      subjectType: 'schedule',
      subjectId: scheduleId,
      locationId: location.id,
      metadata: { ...operations },
    })
  }

  return {
    version,
    notifiedPeople: diff.people.size,
    changedShifts: diff.changedShiftCount,
    openShiftNotices,
  }
}

// ---------------------------------------------------------------------------
// Immediate reassignment, for approved claims and swaps
// ---------------------------------------------------------------------------

export class StaleShiftError extends Error {
  constructor(message = 'The shift changed after this request was made.') {
    super(message)
    this.name = 'StaleShiftError'
  }
}

/**
 * Move a shift from one person to another, NOW, for a decision that has
 * already been approved by a manager.
 *
 * Applied to the published copy too when the shift is published: the people
 * involved agreed to exactly this, so it does not wait for the next
 * publication. Guarded by the shift's version and current assignee - if
 * either moved since the request, it throws StaleShiftError and changes
 * nothing.
 */
export async function reassignNow(
  tx: Tx,
  organizationId: string,
  input: {
    shiftId: string
    from: string | null
    to: string
    expectedVersion: number
    actorEmploymentId: string
    now: Date
  },
): Promise<void> {
  const rows = await tx
    .update(shifts)
    .set({
      assigneeEmploymentId: input.to,
      isOpen: false,
      version: sql`${shifts.version} + 1`,
      publishedAssigneeEmploymentId: sql`case when ${shifts.publishedAt} is not null then ${input.to}::uuid else ${shifts.publishedAssigneeEmploymentId} end`,
      publishedIsOpen: sql`case when ${shifts.publishedAt} is not null then false else ${shifts.publishedIsOpen} end`,
      updatedByEmploymentId: input.actorEmploymentId,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(shifts.organizationId, organizationId),
        eq(shifts.id, input.shiftId),
        eq(shifts.status, 'active'),
        eq(shifts.version, input.expectedVersion),
        input.from === null
          ? isNull(shifts.assigneeEmploymentId)
          : eq(shifts.assigneeEmploymentId, input.from),
      ),
    )
    .returning({ id: shifts.id, publishedAt: shifts.publishedAt })
  if (rows.length === 0) throw new StaleShiftError()
  // Open work on the shift goes with it to the new person.
  if (rows[0]!.publishedAt !== null) {
    await syncOperationsForShifts(
      tx,
      organizationId,
      [input.shiftId],
      input.actorEmploymentId,
      input.now,
    )
  }
}

// ---------------------------------------------------------------------------
// Small reads shared with the other scheduling files
// ---------------------------------------------------------------------------

export async function displayNames(
  tx: Tx,
  organizationId: string,
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  const clean = [...new Set(ids.filter((id): id is string => !!id))]
  if (clean.length === 0) return new Map()
  const rows = await tx
    .select({ id: employments.id, displayName: employments.displayName })
    .from(employments)
    .where(and(eq(employments.organizationId, organizationId), inArray(employments.id, clean)))
  return new Map(rows.map((r) => [r.id, r.displayName]))
}

/** Shifts starting in [from, to) at a location, for conflict previews. */
export async function shiftsStartingBetween(
  tx: Tx,
  organizationId: string,
  locationId: string,
  from: Date,
  to: Date,
) {
  return tx
    .select()
    .from(shifts)
    .where(
      and(
        eq(shifts.organizationId, organizationId),
        eq(shifts.locationId, locationId),
        gte(shifts.startsAt, from),
        lt(shifts.startsAt, to),
      ),
    )
}
