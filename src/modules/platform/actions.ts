'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { readString } from '@/lib/form'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { isUuid } from '@/lib/uuid'
import { requirePlatformStaff } from '@/server/auth/platform-staff'
import {
  staffCaseAssign,
  staffCaseNote,
  staffCaseUpdate,
  staffRecordAccess,
  staffRetryDeliveries,
} from '@/server/db/platform'
import type { ActionState } from '@/modules/people/actions'
import { DIAGNOSTICS_MINUTES, diagnosticsCookieName } from './diagnostics'

/*
 * EverCalm team actions. Each re-checks the session is active staff here AND
 * inside the database function it calls.
 */

function fail(error: unknown, fallback: string): ActionState {
  if (error instanceof ValidationError) return { status: 'error', message: error.message }
  if (error instanceof NotFoundError) return { status: 'error', message: 'Not found.' }
  return { status: 'error', message: fallback }
}

/** Explicit, time-limited and audited: nothing diagnostic is shown until this runs. */
export async function openDiagnosticsAction(formData: FormData): Promise<void> {
  const staff = await requirePlatformStaff('diagnostics')
  const organizationId = readString(formData, 'organizationId')
  if (!isUuid(organizationId)) redirect('/platform')
  await staffRecordAccess(staff.userId, organizationId, 'delivery and background-work diagnostics')
  const store = await cookies()
  store.set(
    diagnosticsCookieName(organizationId),
    String(Date.now() + DIAGNOSTICS_MINUTES * 60_000),
    {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/platform',
      maxAge: DIAGNOSTICS_MINUTES * 60,
    },
  )
  redirect(`/platform/organizations/${organizationId}#diagnostics`)
}

export async function retryDeliveriesAction(
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const staff = await requirePlatformStaff('retry_deliveries')
  const organizationId = readString(formData, 'organizationId')
  const reason = readString(formData, 'reason').trim()
  if (!isUuid(organizationId)) return { status: 'error', message: 'Not found.' }
  if (!reason)
    return {
      status: 'error',
      message: 'Give a reason. It is recorded in the customer’s audit log.',
    }
  try {
    const n = await staffRetryDeliveries(staff.userId, organizationId, reason)
    revalidatePath(`/platform/organizations/${organizationId}`)
    return {
      status: 'success',
      message: `${n} ${n === 1 ? 'notification' : 'notifications'} queued to try again.`,
    }
  } catch (error) {
    return fail(error, 'The retry could not be queued.')
  }
}

export async function staffCaseUpdateAction(
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const staff = await requirePlatformStaff('support')
  const caseId = readString(formData, 'caseId')
  if (!isUuid(caseId)) return { status: 'error', message: 'Not found.' }
  const body = readString(formData, 'body')
  const status = readString(formData, 'status') || null
  if (!body.trim() && !status)
    return { status: 'error', message: 'Write a reply or change the status.' }
  try {
    await staffCaseUpdate(staff.userId, caseId, { body, status })
    revalidatePath('/platform', 'layout')
    return { status: 'success', message: 'Sent to the customer.' }
  } catch (error) {
    return fail(error, 'The update could not be saved.')
  }
}

export async function staffCaseNoteAction(
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const staff = await requirePlatformStaff('support')
  const caseId = readString(formData, 'caseId')
  if (!isUuid(caseId)) return { status: 'error', message: 'Not found.' }
  try {
    await staffCaseNote(staff.userId, caseId, readString(formData, 'body'))
    revalidatePath(`/platform/support/${caseId}`)
    return { status: 'success', message: 'Internal note saved. The customer cannot see it.' }
  } catch (error) {
    return fail(error, 'The note could not be saved.')
  }
}

export async function staffCaseAssignAction(
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const staff = await requirePlatformStaff('support')
  const caseId = readString(formData, 'caseId')
  const assignee = readString(formData, 'assignee')
  if (!isUuid(caseId)) return { status: 'error', message: 'Not found.' }
  try {
    await staffCaseAssign(staff.userId, caseId, assignee || null)
    revalidatePath('/platform', 'layout')
    return { status: 'success', message: assignee ? 'Assigned.' : 'Unassigned.' }
  } catch (error) {
    return fail(error, 'The case could not be assigned.')
  }
}
