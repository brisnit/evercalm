'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { readOptionalString, readString } from '@/lib/form'
import { formatInZone, zonedWallTimeToInstant } from '@/lib/dates'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { withTenant } from '@/server/db'
import { requireActorContext } from '@/server/auth/session'
import {
  ANNOUNCEMENT_PRIORITIES,
  AUDIENCE_SELECTOR_TYPES,
  type AnnouncementPriority,
} from './schema'
import type { AudienceRuleInput } from './audience'
import {
  archiveAnnouncement,
  cancelSchedule,
  createAnnouncement,
  duplicateAnnouncement,
  organizationTimeZone,
  publishAnnouncement,
  reviseAnnouncement,
  scheduleAnnouncement,
  syncRecipients,
  updateDraft,
  type AnnouncementInput,
} from './service'
import { acknowledge, openAnnouncement } from './inbox'
import { sendReminders } from './receipts'

/**
 * Communication server actions.
 *
 * Every one resolves the actor from the SESSION and calls a service that
 * authorizes. Nothing here trusts a posted organization id, a posted audience
 * the author may not use, or a posted priority they may not send - the service
 * re-checks all three, so a hand-crafted request reaches exactly as far as the
 * interface would have let it.
 */

export interface CommsActionState {
  status: 'idle' | 'success' | 'error'
  message?: string
  fieldErrors?: Record<string, string[]>
}

function fail(error: unknown, fallback: string): CommsActionState {
  if (error instanceof ValidationError) {
    return { status: 'error', message: error.message, fieldErrors: error.fieldErrors }
  }
  if (error instanceof ForbiddenError) {
    return { status: 'error', message: 'You do not have permission to do that.' }
  }
  if (error instanceof NotFoundError) {
    return { status: 'error', message: 'We could not find that announcement.' }
  }
  return { status: 'error', message: fallback }
}

function revalidateComms(announcementId?: string): void {
  revalidatePath('/app/comms')
  revalidatePath('/my/inbox')
  revalidatePath('/my')
  revalidatePath('/app')
  if (announcementId) {
    revalidatePath(`/app/comms/${announcementId}`)
    revalidatePath(`/my/inbox/${announcementId}`)
  }
}

/** Parse the audience rules the form posts as JSON. */
function readRules(formData: FormData): AudienceRuleInput[] {
  const raw = readString(formData, 'audience')
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const rules: AudienceRuleInput[] = []
    for (const entry of parsed) {
      if (typeof entry !== 'object' || entry === null) continue
      const record = entry as Record<string, unknown>
      const mode = record.mode === 'exclude' ? 'exclude' : 'include'
      const selectorType = record.selectorType
      // Only known selector types are accepted, so the field cannot be used to
      // reach a targeting concept the resolver does not implement.
      if (
        typeof selectorType !== 'string' ||
        !(AUDIENCE_SELECTOR_TYPES as readonly string[]).includes(selectorType)
      ) {
        continue
      }
      const selectorId = typeof record.selectorId === 'string' ? record.selectorId : null
      rules.push({
        mode,
        selectorType: selectorType as AudienceRuleInput['selectorType'],
        selectorId: selectorType === 'organization' ? null : selectorId,
      })
    }
    return rules
  } catch {
    return []
  }
}

function readPriority(formData: FormData): AnnouncementPriority {
  const value = readString(formData, 'priority')
  return (ANNOUNCEMENT_PRIORITIES as readonly string[]).includes(value ?? '')
    ? (value as AnnouncementPriority)
    : 'normal'
}

/**
 * A datetime-local value - a wall-clock time with no zone - read as a time in
 * the ORGANIZATION's timezone. Parsing it with `new Date()` would silently use
 * the server's zone instead. Empty or malformed means null.
 */
function readDate(formData: FormData, name: string, timeZone: string): Date | null {
  const value = readString(formData, name)
  if (!value) return null
  return zonedWallTimeToInstant(value, timeZone)
}

function loadTimeZone(organizationId: string): Promise<string> {
  return withTenant(organizationId, (tx) => organizationTimeZone(tx, organizationId))
}

function readInput(formData: FormData, timeZone: string): AnnouncementInput {
  const requiresAcknowledgement = readString(formData, 'requiresAcknowledgement') === 'on'
  return {
    title: readString(formData, 'title') ?? '',
    body: readString(formData, 'body') ?? '',
    categoryId: readString(formData, 'categoryId') ?? '',
    priority: readPriority(formData),
    requiresAcknowledgement,
    // A deadline without the checkbox is dropped rather than rejected: the
    // control is disabled in that state, so a stale value is the form's fault.
    acknowledgementDueAt: requiresAcknowledgement
      ? readDate(formData, 'acknowledgementDueAt', timeZone)
      : null,
    expiresAt: readDate(formData, 'expiresAt', timeZone),
    callToActionLabel: readOptionalString(formData, 'callToActionLabel') ?? null,
    callToActionHref: readOptionalString(formData, 'callToActionHref') ?? null,
    eventId: readOptionalString(formData, 'eventId') ?? null,
  }
}

export async function createAnnouncementAction(
  _previous: CommsActionState,
  formData: FormData,
): Promise<CommsActionState> {
  const { actor } = await requireActorContext()
  let created: string
  try {
    const input = readInput(formData, await loadTimeZone(actor.organizationId))
    created = await withTenant(actor.organizationId, (tx) =>
      createAnnouncement(tx, actor, input, readRules(formData)),
    )
  } catch (error) {
    return fail(error, 'We could not save that announcement.')
  }
  revalidateComms(created)
  redirect(`/app/comms/${created}`)
}

export async function updateDraftAction(
  _previous: CommsActionState,
  formData: FormData,
): Promise<CommsActionState> {
  const { actor } = await requireActorContext()
  const announcementId = readString(formData, 'announcementId') ?? ''
  try {
    const input = readInput(formData, await loadTimeZone(actor.organizationId))
    await withTenant(actor.organizationId, (tx) =>
      updateDraft(tx, actor, announcementId, input, readRules(formData)),
    )
  } catch (error) {
    return fail(error, 'We could not save your changes.')
  }
  revalidateComms(announcementId)
  return { status: 'success', message: 'Draft saved.' }
}

export async function publishAnnouncementAction(
  _previous: CommsActionState,
  formData: FormData,
): Promise<CommsActionState> {
  const { actor } = await requireActorContext()
  const announcementId = readString(formData, 'announcementId') ?? ''
  try {
    const outcome = await withTenant(actor.organizationId, (tx) =>
      publishAnnouncement(tx, actor, announcementId),
    )
    revalidateComms(announcementId)
    return {
      status: 'success',
      message:
        `Published to ${outcome.recipients} ${outcome.recipients === 1 ? 'person' : 'people'}.` +
        (outcome.delayed > 0 ? ` ${outcome.delayed} will be notified after quiet hours.` : '') +
        (outcome.suppressed > 0 ? ` ${outcome.suppressed} have this category switched off.` : ''),
    }
  } catch (error) {
    return fail(error, 'We could not publish that announcement.')
  }
}

export async function scheduleAnnouncementAction(
  _previous: CommsActionState,
  formData: FormData,
): Promise<CommsActionState> {
  const { actor } = await requireActorContext()
  const announcementId = readString(formData, 'announcementId') ?? ''
  const timeZone = await loadTimeZone(actor.organizationId)
  const publishAt = readDate(formData, 'publishAt', timeZone)
  if (!publishAt) {
    return {
      status: 'error',
      message: 'Choose when it should go out.',
      fieldErrors: { publishAt: ['Choose a date and time.'] },
    }
  }
  try {
    await withTenant(actor.organizationId, (tx) =>
      scheduleAnnouncement(tx, actor, announcementId, publishAt),
    )
  } catch (error) {
    return fail(error, 'We could not schedule that announcement.')
  }
  revalidateComms(announcementId)
  return {
    status: 'success',
    message: `Scheduled for ${formatInZone(publishAt, timeZone)}. It will go out automatically.`,
  }
}

export async function cancelScheduleAction(
  _previous: CommsActionState,
  formData: FormData,
): Promise<CommsActionState> {
  const { actor } = await requireActorContext()
  const announcementId = readString(formData, 'announcementId') ?? ''
  try {
    await withTenant(actor.organizationId, (tx) => cancelSchedule(tx, actor, announcementId))
  } catch (error) {
    return fail(error, 'We could not cancel that schedule.')
  }
  revalidateComms(announcementId)
  return { status: 'success', message: 'Back to a draft. Nobody was sent anything.' }
}

export async function reviseAnnouncementAction(
  _previous: CommsActionState,
  formData: FormData,
): Promise<CommsActionState> {
  const { actor } = await requireActorContext()
  const announcementId = readString(formData, 'announcementId') ?? ''
  const isMaterial = readString(formData, 'isMaterial') === 'on'
  try {
    const revision = await withTenant(actor.organizationId, (tx) =>
      reviseAnnouncement(tx, actor, announcementId, {
        title: readString(formData, 'title') ?? '',
        body: readString(formData, 'body') ?? '',
        callToActionLabel: readOptionalString(formData, 'callToActionLabel') ?? null,
        callToActionHref: readOptionalString(formData, 'callToActionHref') ?? null,
        isMaterial,
        note: readOptionalString(formData, 'note') ?? null,
      }),
    )
    revalidateComms(announcementId)
    return {
      status: 'success',
      message: isMaterial
        ? `Revision ${revision} published. Everyone who had acknowledged has been asked again.`
        : `Revision ${revision} published.`,
    }
  } catch (error) {
    return fail(error, 'We could not publish that correction.')
  }
}

export async function archiveAnnouncementAction(
  _previous: CommsActionState,
  formData: FormData,
): Promise<CommsActionState> {
  const { actor } = await requireActorContext()
  const announcementId = readString(formData, 'announcementId') ?? ''
  try {
    await withTenant(actor.organizationId, (tx) => archiveAnnouncement(tx, actor, announcementId))
  } catch (error) {
    return fail(error, 'We could not archive that announcement.')
  }
  revalidateComms(announcementId)
  return { status: 'success', message: 'Archived. Receipts are kept.' }
}

export async function duplicateAnnouncementAction(
  _previous: CommsActionState,
  formData: FormData,
): Promise<CommsActionState> {
  const { actor } = await requireActorContext()
  const announcementId = readString(formData, 'announcementId') ?? ''
  let created: string
  try {
    created = await withTenant(actor.organizationId, (tx) =>
      duplicateAnnouncement(tx, actor, announcementId),
    )
  } catch (error) {
    return fail(error, 'We could not duplicate that announcement.')
  }
  revalidateComms(created)
  redirect(`/app/comms/${created}`)
}

export async function sendRemindersAction(
  _previous: CommsActionState,
  formData: FormData,
): Promise<CommsActionState> {
  const { actor } = await requireActorContext()
  const announcementId = readString(formData, 'announcementId') ?? ''
  try {
    const outcome = await withTenant(actor.organizationId, (tx) =>
      sendReminders(tx, actor, announcementId),
    )
    revalidateComms(announcementId)
    return {
      status: 'success',
      message:
        outcome.reminded === 0
          ? 'Nobody is outstanding — no reminders sent.'
          : `Reminded ${outcome.reminded} ${outcome.reminded === 1 ? 'person' : 'people'}.` +
            (outcome.delayed > 0 ? ` ${outcome.delayed} will get it after quiet hours.` : ''),
    }
  } catch (error) {
    return fail(error, 'We could not send those reminders.')
  }
}

export async function syncRecipientsAction(
  _previous: CommsActionState,
  formData: FormData,
): Promise<CommsActionState> {
  const { actor } = await requireActorContext()
  const announcementId = readString(formData, 'announcementId') ?? ''
  try {
    const outcome = await withTenant(actor.organizationId, (tx) =>
      syncRecipients(tx, actor, announcementId),
    )
    revalidateComms(announcementId)
    return {
      status: 'success',
      message:
        outcome.recipients === 0
          ? 'Everyone who matches already has it.'
          : `Added ${outcome.recipients} newly matching ${
              outcome.recipients === 1 ? 'person' : 'people'
            }.`,
    }
  } catch (error) {
    return fail(error, 'We could not update the recipient list.')
  }
}

// ---------------------------------------------------------------------------
// Employee actions
// ---------------------------------------------------------------------------

export async function acknowledgeAction(
  _previous: CommsActionState,
  formData: FormData,
): Promise<CommsActionState> {
  const { actor } = await requireActorContext()
  const announcementId = readString(formData, 'announcementId') ?? ''
  try {
    await withTenant(actor.organizationId, (tx) =>
      acknowledge(tx, actor, actor.employmentId, announcementId),
    )
  } catch (error) {
    return fail(error, 'We could not record your acknowledgement.')
  }
  revalidateComms(announcementId)
  return { status: 'success', message: 'Thank you — your confirmation is recorded.' }
}

/**
 * Mark as read without opening.
 *
 * Deliberately separate from acknowledgement, and it is the only other thing
 * that can set a view: it exists so somebody can clear a notice they have
 * already dealt with on the floor, and it never touches `acknowledged_at`.
 */
export async function markReadAction(
  _previous: CommsActionState,
  formData: FormData,
): Promise<CommsActionState> {
  const { actor } = await requireActorContext()
  const announcementId = readString(formData, 'announcementId') ?? ''
  try {
    await withTenant(actor.organizationId, (tx) =>
      openAnnouncement(tx, actor, actor.employmentId, announcementId, { record: true }),
    )
  } catch (error) {
    return fail(error, 'We could not mark that as read.')
  }
  revalidateComms(announcementId)
  return { status: 'success', message: 'Marked as read.' }
}
