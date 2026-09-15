'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { readString } from '@/lib/form'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { isUuid } from '@/lib/uuid'
import { withTenant } from '@/server/db'
import { requireActorContext } from '@/server/auth/session'
import type { ActionState } from '@/modules/people/actions'
import { createCase, replyToCase } from './service'

function fail(error: unknown, fallback: string): ActionState {
  if (error instanceof ValidationError)
    return { status: 'error', message: error.message, fieldErrors: error.fieldErrors }
  if (error instanceof ForbiddenError)
    return { status: 'error', message: 'You do not have permission to do that.' }
  if (error instanceof NotFoundError)
    return { status: 'error', message: 'We could not find that case.' }
  return { status: 'error', message: fallback }
}

export async function createCaseAction(_p: ActionState, formData: FormData): Promise<ActionState> {
  const { actor } = await requireActorContext()
  let id: string
  try {
    id = await withTenant(actor.organizationId, (tx) =>
      createCase(tx, actor, {
        category: readString(formData, 'category'),
        severity: readString(formData, 'severity'),
        subject: readString(formData, 'subject'),
        description: readString(formData, 'description'),
      }),
    )
  } catch (error) {
    return fail(error, 'The case could not be opened.')
  }
  revalidatePath('/app/support')
  redirect(`/app/support/${id}?opened=1`)
}

export async function replyToCaseAction(_p: ActionState, formData: FormData): Promise<ActionState> {
  const { actor } = await requireActorContext()
  const caseId = readString(formData, 'caseId')
  if (!isUuid(caseId)) return { status: 'error', message: 'We could not find that case.' }
  try {
    const status = await withTenant(actor.organizationId, (tx) =>
      replyToCase(tx, actor, caseId, readString(formData, 'body')),
    )
    revalidatePath(`/app/support/${caseId}`)
    revalidatePath('/app/support')
    return {
      status: 'success',
      message:
        status === 'open' ? 'Update sent. EverCalm support will pick it up.' : 'Update sent.',
    }
  } catch (error) {
    return fail(error, 'Your update could not be sent.')
  }
}
