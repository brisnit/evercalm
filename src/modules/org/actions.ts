'use server'

import { revalidatePath } from 'next/cache'
import { ForbiddenError, ValidationError } from '@/lib/errors'
import { withTenant } from '@/server/db'
import { requireActorContext } from '@/server/auth/session'
import { createLocation } from './service'
import { createLocationSchema } from './validators'

/**
 * Server actions.
 *
 * Every action resolves the actor from the session first - never from client
 * input - then validates, then calls the service, which authorizes. A client
 * cannot choose which organization it acts on.
 */

export interface ActionState {
  status: 'idle' | 'success' | 'error'
  message?: string
  fieldErrors?: Record<string, string[]>
}

export async function createLocationAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { actor } = await requireActorContext()

  const parsed = createLocationSchema.safeParse({
    name: formData.get('name'),
    timezone: formData.get('timezone'),
    city: formData.get('city') ?? '',
    region: formData.get('region') ?? '',
  })

  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Please check the highlighted fields.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  try {
    const location = await withTenant(actor.organizationId, (tx) =>
      createLocation(tx, actor, parsed.data),
    )
    revalidatePath('/app/settings')
    return { status: 'success', message: `Added ${location.name}.` }
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return {
        status: 'error',
        message: 'You do not have permission to add locations.',
      }
    }
    if (error instanceof ValidationError) {
      return { status: 'error', message: error.message, fieldErrors: error.fieldErrors }
    }
    return {
      status: 'error',
      message: 'We could not add that location. Please try again.',
    }
  }
}
