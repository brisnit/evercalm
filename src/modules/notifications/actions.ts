'use server'

import { revalidatePath } from 'next/cache'
import { readString } from '@/lib/form'
import { ForbiddenError, ValidationError } from '@/lib/errors'
import { withTenant } from '@/server/db'
import { requireActorContext } from '@/server/auth/session'
import { AUDIT_ACTIONS, recordAuditEvent } from '@/server/audit'
import { NOTIFICATION_CHANNELS, type NotificationChannel } from '@/server/notifications/types'
import { markNotificationRead, saveSettings, setPreference } from './service'

/**
 * Notification preference actions.
 *
 * Preferences are self-access: the service uses `authorizeSelfOr`, so an
 * employee needs no capability to change their own and an administrator needs
 * `notification.administer` to touch anybody else's.
 */

export interface PreferenceActionState {
  status: 'idle' | 'success' | 'error'
  message?: string
  fieldErrors?: Record<string, string[]>
}

function fail(error: unknown, fallback: string): PreferenceActionState {
  if (error instanceof ValidationError) {
    return { status: 'error', message: error.message, fieldErrors: error.fieldErrors }
  }
  if (error instanceof ForbiddenError) {
    return { status: 'error', message: 'You do not have permission to change that.' }
  }
  return { status: 'error', message: fallback }
}

/** Minutes-from-midnight, from an `<input type="time">`. */
function readMinutes(formData: FormData, name: string, fallback: number): number {
  const value = readString(formData, name)
  if (!value) return fallback
  const [hours, minutes] = value.split(':').map((part) => Number.parseInt(part, 10))
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return fallback
  return Math.min(23, Math.max(0, hours!)) * 60 + Math.min(59, Math.max(0, minutes!))
}

export async function savePreferencesAction(
  _previous: PreferenceActionState,
  formData: FormData,
): Promise<PreferenceActionState> {
  const { actor } = await requireActorContext()

  try {
    await withTenant(actor.organizationId, async (tx) => {
      await saveSettings(tx, actor, actor.employmentId, {
        quietHoursEnabled: readString(formData, 'quietHoursEnabled') === 'on',
        quietStart: readMinutes(formData, 'quietStart', 22 * 60),
        quietEnd: readMinutes(formData, 'quietEnd', 7 * 60),
        timezone: readString(formData, 'timezone') || null,
      })

      // Every switch on the form posts as `pref:<category>:<channel>`. A
      // checkbox that is off posts nothing, so the full set is read from the
      // hidden list of what the form offered rather than from what came back.
      const offered = (readString(formData, 'offered') ?? '').split(',').filter(Boolean)
      for (const key of offered) {
        const [category, channel] = key.split(':')
        if (!category || !channel) continue
        if (!(NOTIFICATION_CHANNELS as readonly string[]).includes(channel)) continue
        const enabled = formData.get(`pref:${key}`) === 'on'
        await setPreference(
          tx,
          actor,
          actor.employmentId,
          category,
          channel as NotificationChannel,
          enabled,
        )
      }

      await recordAuditEvent(tx, actor, {
        action: AUDIT_ACTIONS.NOTIFICATION_PREFERENCES_CHANGED,
        summary: 'Updated their notification preferences',
        subjectType: 'employment',
        subjectId: actor.employmentId,
      })
    })
  } catch (error) {
    return fail(error, 'We could not save your preferences.')
  }

  revalidatePath('/my/notifications')
  return { status: 'success', message: 'Saved.' }
}

export async function dismissNotificationAction(
  _previous: PreferenceActionState,
  formData: FormData,
): Promise<PreferenceActionState> {
  const { actor } = await requireActorContext()
  const notificationId = readString(formData, 'notificationId') ?? ''
  try {
    await withTenant(actor.organizationId, (tx) => markNotificationRead(tx, actor, notificationId))
  } catch (error) {
    return fail(error, 'We could not dismiss that.')
  }
  revalidatePath('/my')
  revalidatePath('/my/inbox')
  return { status: 'success' }
}
