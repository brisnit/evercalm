'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { readString } from '@/lib/form'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { isUuid } from '@/lib/uuid'
import { withTenant } from '@/server/db'
import { requireActorContext } from '@/server/auth/session'
import {
  archiveTemplateSet,
  assignToSlot,
  autofillWeek,
  clearSlot,
  createTemplateSet,
  fillCallout,
  generateWeek,
  reportCallout,
  setDayReview,
  type PatternInput,
} from './slotted'
import { parseTimeOfDay } from './time'

/**
 * Slotted server actions.
 *
 * The actor comes from the session; the location, the schedule and the person
 * are all re-checked by the service against that actor. A form cannot widen
 * what somebody may do by posting a different id.
 */

export interface SlottedActionState {
  status: 'idle' | 'success' | 'error'
  message?: string
  fieldErrors?: Record<string, string[]>
}

function fail(error: unknown, fallback: string): SlottedActionState {
  if (error instanceof ValidationError) {
    return { status: 'error', message: error.message, fieldErrors: error.fieldErrors }
  }
  if (error instanceof ForbiddenError) {
    return { status: 'error', message: error.message || 'You do not have permission to do that.' }
  }
  if (error instanceof NotFoundError) {
    return { status: 'error', message: 'We could not find that. It may have changed.' }
  }
  return { status: 'error', message: fallback }
}

function refresh(): void {
  revalidatePath('/app/schedule', 'layout')
  revalidatePath('/my', 'layout')
  revalidatePath('/app')
}

function readId(formData: FormData, name: string): string {
  const value = readString(formData, name)
  return isUuid(value) ? value : '00000000-0000-0000-0000-000000000000'
}

// --- the template wizard ---------------------------------------------------

/**
 * The wizard posts its shifts as parallel arrays: one entry per row of the
 * "what staffing do you need" step.
 */
function readPatterns(formData: FormData): PatternInput[] {
  const names = formData.getAll('patternName').map(String)
  const roles = formData.getAll('patternRole').map(String)
  const starts = formData.getAll('patternStart').map(String)
  const ends = formData.getAll('patternEnd').map(String)
  const counts = formData.getAll('patternHeadcount').map(String)
  const days = formData.getAll('patternDays').map(String)

  const out: PatternInput[] = []
  for (let i = 0; i < starts.length; i += 1) {
    const start = parseTimeOfDay(starts[i] ?? '')
    const end = parseTimeOfDay(ends[i] ?? '')
    if (start === null || end === null) continue
    const headcount = Number(counts[i] ?? '1')
    out.push({
      name: names[i] ?? 'Shift',
      jobRoleId: isUuid(roles[i] ?? '') ? (roles[i] as string) : null,
      startMinute: start,
      endMinute: end,
      headcount: Number.isInteger(headcount) ? headcount : 1,
      daysOfWeek: (days[i] ?? '')
        .split(',')
        .map((d) => Number(d))
        .filter((d) => d >= 1 && d <= 7),
    })
  }
  return out
}

export async function createTemplateSetAction(
  _previous: SlottedActionState,
  formData: FormData,
): Promise<SlottedActionState> {
  const locationId = readId(formData, 'locationId')
  const { actor } = await requireActorContext()
  let id: string
  try {
    id = await withTenant(actor.organizationId, (tx) =>
      createTemplateSet(tx, actor, locationId, {
        name: readString(formData, 'name'),
        openDays: formData.getAll('openDays').map((d) => Number(d)),
        mealMinutes: Number(readString(formData, 'mealMinutes') || '30'),
        mealAfterMinutes: Number(readString(formData, 'mealAfterMinutes') || '300'),
        restMinutes: Number(readString(formData, 'restMinutes') || '10'),
        restEveryMinutes: Number(readString(formData, 'restEveryMinutes') || '240'),
        staggerBreaks: readString(formData, 'staggerBreaks') !== 'off',
        patterns: readPatterns(formData),
      }),
    )
  } catch (error) {
    return fail(error, 'We could not save that template.')
  }
  refresh()
  redirect(`/app/schedule/templates?saved=${id}`)
}

export async function archiveTemplateSetAction(
  _previous: SlottedActionState,
  formData: FormData,
): Promise<SlottedActionState> {
  const { actor } = await requireActorContext()
  try {
    await withTenant(actor.organizationId, (tx) =>
      archiveTemplateSet(tx, actor, readId(formData, 'templateSetId')),
    )
  } catch (error) {
    return fail(error, 'We could not archive that template.')
  }
  refresh()
  return {
    status: 'success',
    message: 'Template archived. Weeks already built from it are unchanged.',
  }
}

// --- the week --------------------------------------------------------------

export async function generateWeekAction(formData: FormData): Promise<void> {
  const locationId = readId(formData, 'locationId')
  const weekStart = readString(formData, 'weekStart')
  const templateSetId = readId(formData, 'templateSetId')
  const { actor } = await requireActorContext()
  await withTenant(actor.organizationId, (tx) =>
    generateWeek(tx, actor, { locationId, weekStart, templateSetId }),
  )
  refresh()
  redirect(`/app/schedule?location=${locationId}&week=${weekStart}&generated=1`)
}

export async function autofillWeekAction(formData: FormData): Promise<void> {
  const scheduleId = readId(formData, 'scheduleId')
  const { actor } = await requireActorContext()
  await withTenant(actor.organizationId, (tx) => autofillWeek(tx, actor, scheduleId))
  refresh()
  redirect(`/app/schedule/autofill/${scheduleId}`)
}

export async function assignToSlotAction(
  _previous: SlottedActionState,
  formData: FormData,
): Promise<SlottedActionState> {
  const shiftId = readId(formData, 'shiftId')
  const employmentId = readId(formData, 'employmentId')
  const override = readString(formData, 'override') === 'yes'
  const { actor } = await requireActorContext()
  try {
    const result = await withTenant(actor.organizationId, (tx) =>
      assignToSlot(tx, actor, shiftId, employmentId, {
        overrideUnavailable: override,
        reason: readString(formData, 'reason'),
      }),
    )
    refresh()
    return {
      status: 'success',
      message: result.overridden
        ? 'Scheduled, against their stated availability. They will see that you chose to.'
        : 'Scheduled.',
    }
  } catch (error) {
    return fail(error, 'We could not fill that slot.')
  }
}

export async function clearSlotAction(
  _previous: SlottedActionState,
  formData: FormData,
): Promise<SlottedActionState> {
  const { actor } = await requireActorContext()
  try {
    await withTenant(actor.organizationId, (tx) =>
      clearSlot(tx, actor, readId(formData, 'shiftId')),
    )
    refresh()
    return { status: 'success', message: 'Slot is open again.' }
  } catch (error) {
    return fail(error, 'We could not clear that slot.')
  }
}

// --- review ----------------------------------------------------------------

export async function reviewDayAction(formData: FormData): Promise<void> {
  const scheduleId = readId(formData, 'scheduleId')
  const onDate = readString(formData, 'onDate')
  const state = readString(formData, 'state') === 'flagged' ? 'flagged' : 'approved'
  const { actor } = await requireActorContext()
  await withTenant(actor.organizationId, (tx) => setDayReview(tx, actor, scheduleId, onDate, state))
  refresh()
  redirect(`/app/schedule/review/${scheduleId}`)
}

// --- call-outs -------------------------------------------------------------

export async function reportCalloutAction(
  _previous: SlottedActionState,
  formData: FormData,
): Promise<SlottedActionState> {
  const { actor } = await requireActorContext()
  try {
    await withTenant(actor.organizationId, (tx) =>
      reportCallout(tx, actor, readId(formData, 'shiftId'), readString(formData, 'reason')),
    )
    refresh()
    return { status: 'success', message: 'Recorded. Now pick who covers it.' }
  } catch (error) {
    return fail(error, 'We could not record that call-out.')
  }
}

export async function fillCalloutAction(
  _previous: SlottedActionState,
  formData: FormData,
): Promise<SlottedActionState> {
  const { actor } = await requireActorContext()
  try {
    await withTenant(actor.organizationId, (tx) =>
      fillCallout(tx, actor, readId(formData, 'shiftId'), readId(formData, 'employmentId'), {
        overrideUnavailable: readString(formData, 'override') === 'yes',
      }),
    )
    refresh()
    return { status: 'success', message: 'Covered. The shift is theirs.' }
  } catch (error) {
    return fail(error, 'We could not fill that shift.')
  }
}
