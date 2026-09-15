'use server'

import { revalidatePath } from 'next/cache'
import { readString } from '@/lib/form'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { withTenant } from '@/server/db'
import { requireActorContext } from '@/server/auth/session'
import type { ActionState } from '@/modules/people/actions'
import {
  changePlan,
  requestCancellation,
  simulateBilling,
  updateBillingContact,
  withdrawCancellation,
  type Simulation,
} from './service'

/** Billing server actions. Owners only; the service authorizes every one again. */

function fail(error: unknown, fallback: string): ActionState {
  if (error instanceof ValidationError)
    return { status: 'error', message: error.message, fieldErrors: error.fieldErrors }
  if (error instanceof ForbiddenError)
    return { status: 'error', message: error.message || 'You do not have permission to do that.' }
  if (error instanceof NotFoundError) return { status: 'error', message: 'We could not find that.' }
  return { status: 'error', message: fallback }
}

async function run(
  work: Parameters<typeof withTenant>[1] extends never
    ? never
    : (
        tx: Parameters<Parameters<typeof withTenant>[1]>[0],
        actor: Awaited<ReturnType<typeof requireActorContext>>['actor'],
      ) => Promise<unknown>,
  success: string,
  fallback: string,
): Promise<ActionState> {
  const { actor } = await requireActorContext()
  try {
    await withTenant(actor.organizationId, (tx) => work(tx, actor))
  } catch (error) {
    return fail(error, fallback)
  }
  revalidatePath('/app', 'layout')
  return { status: 'success', message: success }
}

export async function updateBillingContactAction(
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return run(
    (tx, actor) =>
      updateBillingContact(tx, actor, {
        name: readString(formData, 'name'),
        email: readString(formData, 'email'),
      }),
    'Billing contact saved.',
    'The billing contact could not be saved.',
  )
}

export async function changePlanAction(_p: ActionState, formData: FormData): Promise<ActionState> {
  return run(
    (tx, actor) => changePlan(tx, actor, readString(formData, 'plan')),
    'Plan updated. Nothing is charged: payments are not connected yet.',
    'The plan could not be changed.',
  )
}

export async function requestCancellationAction(_p: ActionState): Promise<ActionState> {
  return run(
    (tx, actor) => requestCancellation(tx, actor),
    'Cancellation requested. Everything keeps working until the date shown.',
    'The cancellation could not be requested.',
  )
}

export async function withdrawCancellationAction(_p: ActionState): Promise<ActionState> {
  return run(
    (tx, actor) => withdrawCancellation(tx, actor),
    'Cancellation withdrawn.',
    'That could not be saved.',
  )
}

const SIMULATIONS: readonly Simulation[] = [
  'payment_succeeded',
  'payment_failed',
  'payment_method_added',
  'advance_to_trial_end',
]

export async function simulateBillingAction(
  _p: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const simulation = readString(formData, 'simulation') as Simulation
  if (!SIMULATIONS.includes(simulation)) return { status: 'error', message: 'Choose a simulation.' }
  return run(
    (tx, actor) => simulateBilling(tx, actor, simulation),
    'Simulated. The history below shows what the provider event changed.',
    'The simulation could not run.',
  )
}
