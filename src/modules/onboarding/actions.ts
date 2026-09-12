'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { readString } from '@/lib/form'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { withTenant } from '@/server/db'
import { requireActorContext } from '@/server/auth/session'
import { blockStep, completeStep } from './service'

export interface OnboardingActionState {
  status: 'idle' | 'success' | 'error'
  message?: string
}

const stepSchema = z.object({
  stepProgressId: z.uuid(),
  note: z.string().trim().max(300).optional(),
})

export async function completeStepAction(
  _previous: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  const { actor } = await requireActorContext()
  const parsed = stepSchema.safeParse({
    stepProgressId: formData.get('stepProgressId'),
    note: formData.get('note') ?? '',
  })
  if (!parsed.success) return { status: 'error', message: 'That step could not be identified.' }

  try {
    await withTenant(actor.organizationId, (tx) =>
      completeStep(tx, actor, parsed.data.stepProgressId, parsed.data.note),
    )
    revalidatePath('/my/onboarding')
    revalidatePath('/my')
    revalidatePath('/app/onboarding')
    revalidatePath('/app')
    return { status: 'success', message: 'Done.' }
  } catch (error) {
    if (error instanceof ValidationError) return { status: 'error', message: error.message }
    if (error instanceof ForbiddenError) {
      return { status: 'error', message: 'Only a manager can confirm this step.' }
    }
    if (error instanceof NotFoundError) return { status: 'error', message: 'Step not found.' }
    return { status: 'error', message: 'We could not update that step.' }
  }
}

export async function blockStepAction(
  _previous: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  const { actor } = await requireActorContext()
  const stepProgressId = readString(formData, 'stepProgressId', '')
  const reason = readString(formData, 'reason', '')

  try {
    await withTenant(actor.organizationId, (tx) => blockStep(tx, actor, stepProgressId, reason))
    revalidatePath('/my/onboarding')
    revalidatePath('/app/onboarding')
    return { status: 'success', message: 'Flagged. Your manager can see what is blocking you.' }
  } catch (error) {
    if (error instanceof ValidationError) return { status: 'error', message: error.message }
    return { status: 'error', message: 'We could not flag that step.' }
  }
}
