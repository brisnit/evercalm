'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { readString } from '@/lib/form'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { isUuid } from '@/lib/uuid'
import { withTenant } from '@/server/db'
import { requireActorContext } from '@/server/auth/session'
import { demoRestriction } from '@/server/demo'
import { archiveDocument, uploadDocument } from './service'

/**
 * Document server actions.
 *
 * The file arrives as part of the form. It is read into memory once, checked
 * against the size and type the service allows, and handed over - the service
 * decides whether this person may add it at all.
 */

export interface DocumentActionState {
  status: 'idle' | 'success' | 'error'
  message?: string
  fieldErrors?: Record<string, string[]>
}

function fail(error: unknown, fallback: string): DocumentActionState {
  if (error instanceof ValidationError) {
    return { status: 'error', message: error.message, fieldErrors: error.fieldErrors }
  }
  if (error instanceof ForbiddenError) {
    return { status: 'error', message: 'You do not have permission to do that.' }
  }
  if (error instanceof NotFoundError) {
    return { status: 'error', message: 'We could not find that document.' }
  }
  return { status: 'error', message: fallback }
}

export async function uploadDocumentAction(
  _previous: DocumentActionState,
  formData: FormData,
): Promise<DocumentActionState> {
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return { status: 'error', message: 'Choose a file.', fieldErrors: { file: ['Choose a file'] } }
  }

  const { actor } = await requireActorContext()
  try {
    const bytes = Buffer.from(await file.arrayBuffer())
    const locationId = readString(formData, 'locationId')
    await withTenant(actor.organizationId, (tx) =>
      uploadDocument(tx, actor, {
        title: readString(formData, 'title') || file.name,
        description: readString(formData, 'description'),
        category: readString(formData, 'category'),
        visibility: readString(formData, 'visibility'),
        locationId: isUuid(locationId) ? locationId : null,
        fileName: file.name,
        contentType: file.type,
        bytes,
      }),
    )
    revalidatePath('/app/documents')
    revalidatePath('/my/documents')
    return { status: 'success', message: 'Added. Everyone it is for can open it now.' }
  } catch (error) {
    return fail(error, 'We could not add that document.')
  }
}

export async function archiveDocumentAction(
  _previous: DocumentActionState,
  formData: FormData,
): Promise<DocumentActionState> {
  const restricted = demoRestriction()
  if (restricted) return restricted

  const id = z.uuid().safeParse(formData.get('documentId'))
  if (!id.success) return { status: 'error', message: 'Please check the form.' }

  const { actor } = await requireActorContext()
  try {
    await withTenant(actor.organizationId, (tx) => archiveDocument(tx, actor, id.data))
    revalidatePath('/app/documents')
    revalidatePath('/my/documents')
    return { status: 'success', message: 'Removed. The record of it stays in the audit log.' }
  } catch (error) {
    return fail(error, 'We could not remove that document.')
  }
}
