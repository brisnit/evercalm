'use server'

import { demoRestriction } from '@/server/demo'
import { revalidatePath } from 'next/cache'
import { ForbiddenError } from '@/lib/errors'
import { withTenant } from '@/server/db'
import { requireActorContext } from '@/server/auth/session'
import type { ActionState } from '@/modules/people/actions'
import { retryFailedNotifications } from './service'

export async function retryFailedNotificationsAction(_p: ActionState): Promise<ActionState> {
  const restricted = demoRestriction()
  if (restricted) return restricted
  const { actor } = await requireActorContext()
  try {
    const n = await withTenant(actor.organizationId, (tx) => retryFailedNotifications(tx, actor))
    revalidatePath('/app/settings/status')
    return {
      status: 'success',
      message:
        n === 0
          ? 'Nothing to retry.'
          : `${n} ${n === 1 ? 'notification is' : 'notifications are'} queued to try again.`,
    }
  } catch (error) {
    if (error instanceof ForbiddenError)
      return { status: 'error', message: 'You do not have permission to do that.' }
    return { status: 'error', message: 'That could not be queued.' }
  }
}
