'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { readString } from '@/lib/form'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { isUuid } from '@/lib/uuid'
import { withTenant } from '@/server/db'
import { requireActorContext } from '@/server/auth/session'
import {
  applyTemplates,
  archiveTemplate,
  assignShift,
  cancelShift,
  createShift,
  createTemplate,
  publishSchedule,
  setShiftOpen,
  updateShift,
  updateTemplate,
  type TemplateInput,
} from './service'
import {
  addAvailabilityException,
  cancelSwap,
  cancelTimeOff,
  claimOpenShift,
  decideClaim,
  decideSwap,
  decideTimeOff,
  removeAvailabilityException,
  replaceWeeklyAvailability,
  requestSwap,
  requestTimeOff,
  respondToSwap,
  withdrawClaim,
  type AvailabilityRuleInput,
} from './requests'
import { MINUTES_PER_DAY, parseTimeOfDay } from './time'

/**
 * Scheduling server actions.
 *
 * Each resolves the actor from the session and hands the raw input to a
 * service that authorizes against the LOCATION involved and re-validates
 * everything. Nothing posted here - a location id, a person, a shift - is
 * trusted to be within the actor's reach just because a form offered it.
 */

export interface ScheduleActionState {
  status: 'idle' | 'success' | 'error'
  message?: string
  fieldErrors?: Record<string, string[]>
}

function fail(error: unknown, fallback: string): ScheduleActionState {
  if (error instanceof ValidationError) {
    return { status: 'error', message: error.message, fieldErrors: error.fieldErrors }
  }
  if (error instanceof ForbiddenError) {
    return { status: 'error', message: error.message || 'You do not have permission to do that.' }
  }
  if (error instanceof NotFoundError) {
    return {
      status: 'error',
      message: 'We could not find that. It may have been changed or removed.',
    }
  }
  return { status: 'error', message: fallback }
}

function refresh(): void {
  revalidatePath('/app/schedule', 'layout')
  revalidatePath('/my', 'layout')
  revalidatePath('/app')
}

/** "HH:MM" to minutes; anything else becomes -1, which the service rejects with a field error. */
function readTime(formData: FormData, name: string): number {
  return parseTimeOfDay(readString(formData, name)) ?? -1
}

function readInt(formData: FormData, name: string, fallback = 0): number {
  const raw = readString(formData, name)
  if (raw === '') return fallback
  const value = Number(raw)
  return Number.isInteger(value) ? value : Number.NaN
}

function readUuidOrNull(formData: FormData, name: string): string | null {
  const value = readString(formData, name)
  return isUuid(value) ? value : null
}

function readId(formData: FormData, name: string): string {
  const value = readString(formData, name)
  // A malformed id is simply not found - never a database error.
  return isUuid(value) ? value : '00000000-0000-0000-0000-000000000000'
}

function withWarnings(message: string, warnings: string[]): string {
  return warnings.length === 0 ? message : `${message} Heads up: ${warnings.join(' ')}`
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function readTemplate(formData: FormData): TemplateInput {
  return {
    name: readString(formData, 'name'),
    jobRoleId: readUuidOrNull(formData, 'jobRoleId'),
    stationId: readUuidOrNull(formData, 'stationId'),
    startMinute: readTime(formData, 'startTime'),
    endMinute: readTime(formData, 'endTime'),
    breakMinutes: readInt(formData, 'breakMinutes'),
    daysOfWeek: formData.getAll('days').map((d) => Number(d)),
    headcount: readInt(formData, 'headcount', 1),
    notes: readString(formData, 'notes'),
  }
}

export async function createTemplateAction(
  _previous: ScheduleActionState,
  formData: FormData,
): Promise<ScheduleActionState> {
  const { actor } = await requireActorContext()
  try {
    await withTenant(actor.organizationId, (tx) =>
      createTemplate(tx, actor, readId(formData, 'locationId'), readTemplate(formData)),
    )
  } catch (error) {
    return fail(error, 'We could not save that template.')
  }
  refresh()
  return { status: 'success', message: 'Template saved.' }
}

export async function updateTemplateAction(
  _previous: ScheduleActionState,
  formData: FormData,
): Promise<ScheduleActionState> {
  const { actor } = await requireActorContext()
  try {
    await withTenant(actor.organizationId, (tx) =>
      updateTemplate(tx, actor, readId(formData, 'templateId'), readTemplate(formData)),
    )
  } catch (error) {
    return fail(error, 'We could not save that template.')
  }
  refresh()
  return {
    status: 'success',
    message: 'Template updated. Shifts already made from it are unchanged.',
  }
}

export async function archiveTemplateAction(
  _previous: ScheduleActionState,
  formData: FormData,
): Promise<ScheduleActionState> {
  const { actor } = await requireActorContext()
  try {
    await withTenant(actor.organizationId, (tx) =>
      archiveTemplate(tx, actor, readId(formData, 'templateId')),
    )
  } catch (error) {
    return fail(error, 'We could not archive that template.')
  }
  refresh()
  return { status: 'success', message: 'Template archived.' }
}

export async function applyTemplatesAction(
  _previous: ScheduleActionState,
  formData: FormData,
): Promise<ScheduleActionState> {
  const { actor } = await requireActorContext()
  try {
    const selected = formData.getAll('templateIds').map(String).filter(isUuid)
    const result = await withTenant(actor.organizationId, (tx) =>
      applyTemplates(
        tx,
        actor,
        readId(formData, 'locationId'),
        readString(formData, 'weekStart'),
        selected.length > 0 ? selected : undefined,
      ),
    )
    refresh()
    return {
      status: 'success',
      message:
        result.created === 0
          ? 'Every template already has its shifts this week. Nothing was added.'
          : `Added ${result.created} ${result.created === 1 ? 'shift' : 'shifts'} from templates. Assign people to them next.`,
    }
  } catch (error) {
    return fail(error, 'We could not apply those templates.')
  }
}

// ---------------------------------------------------------------------------
// Shifts
// ---------------------------------------------------------------------------

export async function createShiftAction(
  _previous: ScheduleActionState,
  formData: FormData,
): Promise<ScheduleActionState> {
  const { actor } = await requireActorContext()
  try {
    const result = await withTenant(actor.organizationId, (tx) =>
      createShift(tx, actor, readId(formData, 'locationId'), {
        date: readString(formData, 'date'),
        startMinute: readTime(formData, 'startTime'),
        endMinute: readTime(formData, 'endTime'),
        breakMinutes: readInt(formData, 'breakMinutes'),
        jobRoleId: readUuidOrNull(formData, 'jobRoleId'),
        stationId: readUuidOrNull(formData, 'stationId'),
        notes: readString(formData, 'notes'),
        assigneeEmploymentId: readUuidOrNull(formData, 'assigneeEmploymentId'),
        templateId: readUuidOrNull(formData, 'templateId'),
      }),
    )
    refresh()
    return { status: 'success', message: withWarnings('Shift added.', result.warnings) }
  } catch (error) {
    return fail(error, 'We could not add that shift.')
  }
}

export async function updateShiftAction(
  _previous: ScheduleActionState,
  formData: FormData,
): Promise<ScheduleActionState> {
  const { actor } = await requireActorContext()
  try {
    const result = await withTenant(actor.organizationId, (tx) =>
      updateShift(tx, actor, readId(formData, 'shiftId'), {
        date: readString(formData, 'date'),
        startMinute: readTime(formData, 'startTime'),
        endMinute: readTime(formData, 'endTime'),
        breakMinutes: readInt(formData, 'breakMinutes'),
        jobRoleId: readUuidOrNull(formData, 'jobRoleId'),
        stationId: readUuidOrNull(formData, 'stationId'),
        notes: readString(formData, 'notes'),
      }),
    )
    refresh()
    return { status: 'success', message: withWarnings('Shift updated.', result.warnings) }
  } catch (error) {
    return fail(error, 'We could not update that shift.')
  }
}

export async function assignShiftAction(
  _previous: ScheduleActionState,
  formData: FormData,
): Promise<ScheduleActionState> {
  const { actor } = await requireActorContext()
  const employmentId = readUuidOrNull(formData, 'assigneeEmploymentId')
  try {
    const result = await withTenant(actor.organizationId, (tx) =>
      assignShift(tx, actor, readId(formData, 'shiftId'), employmentId),
    )
    refresh()
    return {
      status: 'success',
      message: withWarnings(
        employmentId ? 'Assigned.' : 'Nobody is assigned now.',
        result.warnings,
      ),
    }
  } catch (error) {
    return fail(error, 'We could not change who is on that shift.')
  }
}

export async function setShiftOpenAction(
  _previous: ScheduleActionState,
  formData: FormData,
): Promise<ScheduleActionState> {
  const { actor } = await requireActorContext()
  const open = readString(formData, 'open') === 'true'
  try {
    await withTenant(actor.organizationId, (tx) =>
      setShiftOpen(tx, actor, readId(formData, 'shiftId'), open),
    )
  } catch (error) {
    return fail(error, 'We could not change that shift.')
  }
  refresh()
  return {
    status: 'success',
    message: open
      ? 'Offered as an open shift. People are told when you publish.'
      : 'No longer offered as an open shift.',
  }
}

export async function cancelShiftAction(
  _previous: ScheduleActionState,
  formData: FormData,
): Promise<ScheduleActionState> {
  const { actor } = await requireActorContext()
  const returnTo = readString(formData, 'returnTo')
  let outcome: 'deleted' | 'cancelled'
  try {
    outcome = await withTenant(actor.organizationId, (tx) =>
      cancelShift(tx, actor, readId(formData, 'shiftId')),
    )
  } catch (error) {
    return fail(error, 'We could not remove that shift.')
  }
  refresh()
  if (outcome === 'deleted' && returnTo.startsWith('/app/schedule')) redirect(returnTo)
  return {
    status: 'success',
    message:
      outcome === 'deleted'
        ? 'Shift deleted.'
        : 'Shift cancelled. The person on it is told when you publish the change.',
  }
}

export async function publishScheduleAction(
  _previous: ScheduleActionState,
  formData: FormData,
): Promise<ScheduleActionState> {
  const { actor } = await requireActorContext()
  try {
    const result = await withTenant(actor.organizationId, (tx) =>
      publishSchedule(tx, actor, readId(formData, 'scheduleId')),
    )
    refresh()
    const people = `${result.notifiedPeople} ${result.notifiedPeople === 1 ? 'person' : 'people'}`
    return {
      status: 'success',
      message:
        result.version === 1
          ? `Published. ${people} can see their shifts and have been notified.`
          : `Changes published. ${people} whose shifts changed have been notified.` +
            (result.openShiftNotices > 0
              ? ' Eligible people were told about new open shifts.'
              : ''),
    }
  } catch (error) {
    return fail(error, 'We could not publish this schedule.')
  }
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

function readDecision<T extends string>(formData: FormData, allowed: readonly T[]): T | null {
  const value = readString(formData, 'decision')
  return (allowed as readonly string[]).includes(value) ? (value as T) : null
}

export async function decideTimeOffAction(
  _previous: ScheduleActionState,
  formData: FormData,
): Promise<ScheduleActionState> {
  const { actor } = await requireActorContext()
  const decision = readDecision(formData, ['approved', 'denied'] as const)
  if (!decision) return { status: 'error', message: 'Choose approve or deny.' }
  try {
    const result = await withTenant(actor.organizationId, (tx) =>
      decideTimeOff(
        tx,
        actor,
        readId(formData, 'requestId'),
        decision,
        readString(formData, 'note'),
      ),
    )
    refresh()
    if (decision === 'denied')
      return { status: 'success', message: 'Time off denied. They have been told.' }
    return {
      status: 'success',
      message:
        result.affectedShifts.length === 0
          ? 'Time off approved. They have been told.'
          : `Time off approved. ${result.affectedShifts.length} of their assigned ${
              result.affectedShifts.length === 1 ? 'shift now conflicts' : 'shifts now conflict'
            } - reassign or open ${result.affectedShifts.length === 1 ? 'it' : 'them'} before publishing.`,
    }
  } catch (error) {
    return fail(error, 'We could not record that decision.')
  }
}

export async function decideClaimAction(
  _previous: ScheduleActionState,
  formData: FormData,
): Promise<ScheduleActionState> {
  const { actor } = await requireActorContext()
  const decision = readDecision(formData, ['approved', 'declined'] as const)
  if (!decision) return { status: 'error', message: 'Choose give it to them or decline.' }
  try {
    await withTenant(actor.organizationId, (tx) =>
      decideClaim(tx, actor, readId(formData, 'claimId'), decision, readString(formData, 'note')),
    )
  } catch (error) {
    return fail(error, 'We could not record that decision.')
  }
  refresh()
  return {
    status: 'success',
    message:
      decision === 'approved'
        ? 'The shift is theirs. Anyone else who asked has been told.'
        : 'Request declined. They have been told.',
  }
}

export async function decideSwapAction(
  _previous: ScheduleActionState,
  formData: FormData,
): Promise<ScheduleActionState> {
  const { actor } = await requireActorContext()
  const decision = readDecision(formData, ['approved', 'denied'] as const)
  if (!decision) return { status: 'error', message: 'Choose approve or deny.' }
  try {
    const result = await withTenant(actor.organizationId, (tx) =>
      decideSwap(tx, actor, readId(formData, 'requestId'), decision, readString(formData, 'note')),
    )
    refresh()
    if (result === 'expired') {
      return {
        status: 'error',
        message:
          'This swap could not go ahead: the shift changed or started after it was agreed. Both people have been told.',
      }
    }
    return {
      status: 'success',
      message:
        result === 'approved'
          ? 'Swap approved. The schedule is updated and both people have been told.'
          : 'Swap denied. Both people have been told.',
    }
  } catch (error) {
    return fail(error, 'We could not record that decision.')
  }
}

// ---------------------------------------------------------------------------
// Employee: time off and availability
// ---------------------------------------------------------------------------

export async function requestTimeOffAction(
  _previous: ScheduleActionState,
  formData: FormData,
): Promise<ScheduleActionState> {
  const { actor } = await requireActorContext()
  const partOfDay = readString(formData, 'partOfDay') === 'on'
  try {
    await withTenant(actor.organizationId, (tx) =>
      requestTimeOff(tx, actor, {
        startsOn: readString(formData, 'startsOn'),
        endsOn: readString(formData, 'endsOn') || readString(formData, 'startsOn'),
        startMinute: partOfDay ? readTime(formData, 'startTime') : null,
        endMinute: partOfDay ? readTime(formData, 'endTime') : null,
        reason: readString(formData, 'reason'),
        note: readString(formData, 'note'),
      }),
    )
  } catch (error) {
    return fail(error, 'We could not send that request.')
  }
  refresh()
  return { status: 'success', message: 'Request sent. You will be told when a manager decides.' }
}

export async function cancelTimeOffAction(
  _previous: ScheduleActionState,
  formData: FormData,
): Promise<ScheduleActionState> {
  const { actor } = await requireActorContext()
  try {
    await withTenant(actor.organizationId, (tx) =>
      cancelTimeOff(tx, actor, readId(formData, 'requestId')),
    )
  } catch (error) {
    return fail(error, 'We could not cancel that request.')
  }
  refresh()
  return { status: 'success', message: 'Request cancelled.' }
}

/**
 * Weekly availability arrives as one row per day: a choice, and either
 * "all day" or a time window.
 */
export async function saveAvailabilityAction(
  _previous: ScheduleActionState,
  formData: FormData,
): Promise<ScheduleActionState> {
  const { actor } = await requireActorContext()
  const rules: AvailabilityRuleInput[] = []
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    const preference = readString(formData, `d${weekday}-preference`)
    if (!preference || preference === 'none') continue
    const allDay = readString(formData, `d${weekday}-allDay`) === 'on'
    rules.push({
      weekday,
      preference,
      startMinute: allDay ? 0 : readTime(formData, `d${weekday}-start`),
      endMinute: allDay
        ? MINUTES_PER_DAY
        : readString(formData, `d${weekday}-end`) === '00:00'
          ? MINUTES_PER_DAY
          : readTime(formData, `d${weekday}-end`),
    })
  }
  try {
    await withTenant(actor.organizationId, (tx) =>
      replaceWeeklyAvailability(tx, actor, actor.employmentId, rules),
    )
  } catch (error) {
    return fail(error, 'We could not save your availability.')
  }
  refresh()
  return {
    status: 'success',
    message: 'Availability saved. Managers see it when they build the schedule.',
  }
}

export async function addAvailabilityExceptionAction(
  _previous: ScheduleActionState,
  formData: FormData,
): Promise<ScheduleActionState> {
  const { actor } = await requireActorContext()
  const allDay = readString(formData, 'allDay') === 'on'
  try {
    await withTenant(actor.organizationId, (tx) =>
      addAvailabilityException(tx, actor, actor.employmentId, {
        onDate: readString(formData, 'onDate'),
        startMinute: allDay ? null : readTime(formData, 'startTime'),
        endMinute: allDay ? null : readTime(formData, 'endTime'),
        preference: readString(formData, 'preference'),
        note: readString(formData, 'note'),
      }),
    )
  } catch (error) {
    return fail(error, 'We could not save that date.')
  }
  refresh()
  return { status: 'success', message: 'Saved for that date.' }
}

export async function removeAvailabilityExceptionAction(
  _previous: ScheduleActionState,
  formData: FormData,
): Promise<ScheduleActionState> {
  const { actor } = await requireActorContext()
  try {
    await withTenant(actor.organizationId, (tx) =>
      removeAvailabilityException(tx, actor, readId(formData, 'exceptionId')),
    )
  } catch (error) {
    return fail(error, 'We could not remove that date.')
  }
  refresh()
  return { status: 'success', message: 'Removed.' }
}

// ---------------------------------------------------------------------------
// Employee: open shifts and swaps
// ---------------------------------------------------------------------------

export async function claimOpenShiftAction(
  _previous: ScheduleActionState,
  formData: FormData,
): Promise<ScheduleActionState> {
  const { actor } = await requireActorContext()
  try {
    const result = await withTenant(actor.organizationId, (tx) =>
      claimOpenShift(tx, actor, readId(formData, 'shiftId'), readString(formData, 'note')),
    )
    refresh()
    return {
      status: 'success',
      message: withWarnings('Request sent. A manager decides who gets the shift.', result.warnings),
    }
  } catch (error) {
    return fail(error, 'We could not send that request.')
  }
}

export async function withdrawClaimAction(
  _previous: ScheduleActionState,
  formData: FormData,
): Promise<ScheduleActionState> {
  const { actor } = await requireActorContext()
  try {
    await withTenant(actor.organizationId, (tx) =>
      withdrawClaim(tx, actor, readId(formData, 'claimId')),
    )
  } catch (error) {
    return fail(error, 'We could not withdraw that request.')
  }
  refresh()
  return { status: 'success', message: 'Request withdrawn.' }
}

export async function requestSwapAction(
  _previous: ScheduleActionState,
  formData: FormData,
): Promise<ScheduleActionState> {
  const { actor } = await requireActorContext()
  const kind = readString(formData, 'kind') === 'trade' ? 'trade' : 'giveaway'
  try {
    await withTenant(actor.organizationId, (tx) =>
      requestSwap(tx, actor, {
        shiftId: readId(formData, 'shiftId'),
        kind,
        recipientEmploymentId: readId(formData, 'recipientEmploymentId'),
        recipientShiftId: kind === 'trade' ? readUuidOrNull(formData, 'recipientShiftId') : null,
        note: readString(formData, 'note'),
      }),
    )
  } catch (error) {
    return fail(error, 'We could not send that request.')
  }
  refresh()
  return {
    status: 'success',
    message: 'Request sent. Your colleague agrees first, then a manager confirms it.',
  }
}

export async function respondToSwapAction(
  _previous: ScheduleActionState,
  formData: FormData,
): Promise<ScheduleActionState> {
  const { actor } = await requireActorContext()
  const accept = readString(formData, 'accept') === 'true'
  try {
    await withTenant(actor.organizationId, (tx) =>
      respondToSwap(tx, actor, readId(formData, 'requestId'), accept),
    )
  } catch (error) {
    return fail(error, 'We could not record your answer.')
  }
  refresh()
  return {
    status: 'success',
    message: accept
      ? 'You agreed. A manager confirms it, and you will both be told.'
      : 'You declined. They have been told.',
  }
}

export async function cancelSwapAction(
  _previous: ScheduleActionState,
  formData: FormData,
): Promise<ScheduleActionState> {
  const { actor } = await requireActorContext()
  try {
    await withTenant(actor.organizationId, (tx) =>
      cancelSwap(tx, actor, readId(formData, 'requestId')),
    )
  } catch (error) {
    return fail(error, 'We could not withdraw that request.')
  }
  refresh()
  return { status: 'success', message: 'Swap request withdrawn.' }
}
