'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { withTenant } from '@/server/db'
import { requireActorContext } from '@/server/auth/session'
import {
  archiveChannel,
  createChannel,
  openThread,
  postToChannel,
  sendDirectMessage,
} from './service'

/**
 * Messaging server actions.
 *
 * The actor comes from the session, never from the form, so a client cannot
 * post as somebody else or into another organization's channel. Every
 * function here delegates the decision to the service.
 */

export interface ActionState {
  status: 'idle' | 'success' | 'error'
  message?: string
  fieldErrors?: Record<string, string[]>
}

function toState(error: unknown, fallback: string): ActionState {
  if (error instanceof ValidationError) {
    return { status: 'error', message: error.message, fieldErrors: error.fieldErrors }
  }
  if (error instanceof ForbiddenError) {
    return { status: 'error', message: 'You do not have permission to do that.' }
  }
  if (error instanceof NotFoundError) {
    return { status: 'error', message: 'We could not find that conversation.' }
  }
  return { status: 'error', message: fallback }
}

const channelSchema = z.object({
  name: z.string().trim().min(1, 'Give the channel a name').max(60, 'That name is too long'),
  purpose: z.string().trim().max(200, 'Keep the description short').optional(),
  audience: z.enum(['managers', 'everyone']),
})

export async function createChannelAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = channelSchema.safeParse({
    name: formData.get('name') ?? '',
    purpose: formData.get('purpose') ?? undefined,
    audience: formData.get('audience') ?? 'everyone',
  })
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Please check the form.',
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
    }
  }

  const { actor } = await requireActorContext()
  try {
    await withTenant(actor.organizationId, (tx) => createChannel(tx, actor, parsed.data))
    revalidatePath('/app/comms/channels')
    revalidatePath('/my/inbox')
    return { status: 'success', message: `#${parsed.data.name} is open.` }
  } catch (error) {
    return toState(error, 'We could not create that channel.')
  }
}

export async function archiveChannelAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const channelId = z.uuid().safeParse(formData.get('channelId'))
  if (!channelId.success) return { status: 'error', message: 'Please check the form.' }

  const { actor } = await requireActorContext()
  try {
    await withTenant(actor.organizationId, (tx) => archiveChannel(tx, actor, channelId.data))
  } catch (error) {
    return toState(error, 'We could not archive that channel.')
  }
  revalidatePath('/app/comms/channels')
  revalidatePath('/my/inbox')
  // Outside the try: redirect works by throwing, and the archived channel's
  // own page no longer exists to return to.
  redirect('/app/comms/channels')
}

const postSchema = z.object({
  channelId: z.uuid(),
  body: z.string().trim().min(1, 'Write a message first').max(4000, 'That message is too long'),
})

export async function postToChannelAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = postSchema.safeParse({
    channelId: formData.get('channelId'),
    body: formData.get('body') ?? '',
  })
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Please check the form.',
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
    }
  }

  const { actor } = await requireActorContext()
  try {
    await withTenant(actor.organizationId, (tx) =>
      postToChannel(tx, actor, parsed.data.channelId, parsed.data.body),
    )
    revalidatePath(`/app/comms/channels/${parsed.data.channelId}`)
    revalidatePath(`/my/inbox/channels/${parsed.data.channelId}`)
    return { status: 'success' }
  } catch (error) {
    return toState(error, 'We could not post that message.')
  }
}

const messageSchema = z.object({
  threadId: z.uuid(),
  body: z.string().trim().min(1, 'Write a message first').max(4000, 'That message is too long'),
})

export async function sendDirectMessageAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = messageSchema.safeParse({
    threadId: formData.get('threadId'),
    body: formData.get('body') ?? '',
  })
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Please check the form.',
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
    }
  }

  const { actor } = await requireActorContext()
  try {
    await withTenant(actor.organizationId, (tx) =>
      sendDirectMessage(tx, actor, parsed.data.threadId, parsed.data.body),
    )
    revalidatePath(`/app/comms/messages/${parsed.data.threadId}`)
    revalidatePath(`/my/inbox/messages/${parsed.data.threadId}`)
    revalidatePath('/app/comms/messages')
    revalidatePath('/my/inbox')
    return { status: 'success' }
  } catch (error) {
    return toState(error, 'We could not send that message.')
  }
}

/**
 * Open (or reopen) the conversation with one person and go to it.
 *
 * A redirect rather than a state, because the point of the button is to land
 * in the conversation. Opening one twice returns the same thread.
 */
export async function openThreadAction(formData: FormData): Promise<void> {
  const parsed = z.object({ employmentId: z.uuid(), from: z.enum(['app', 'my']) }).safeParse({
    employmentId: formData.get('employmentId'),
    from: formData.get('from') ?? 'app',
  })
  if (!parsed.success) return

  const { actor } = await requireActorContext()
  const threadId = await withTenant(actor.organizationId, (tx) =>
    openThread(tx, actor, parsed.data.employmentId),
  )
  redirect(
    parsed.data.from === 'my'
      ? `/my/inbox/messages/${threadId}`
      : `/app/comms/messages/${threadId}`,
  )
}
