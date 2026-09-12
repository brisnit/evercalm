'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { readString } from '@/lib/form'
import { getEnv } from '@/lib/env'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { withTenant } from '@/server/db'
import { requireActorContext } from '@/server/auth/session'
import { emailProvider } from '@/server/email'
import { createInvitation, resendInvitation, revokeInvitation } from './service'

/**
 * Invitation server actions.
 *
 * Email delivery goes through the provider interface, which is in
 * development-safe mode until a sending domain is approved: the message is
 * recorded and nothing leaves the machine. The acceptance link is returned to
 * the inviter so a pilot can still be onboarded by hand.
 */

export interface InviteActionState {
  status: 'idle' | 'success' | 'error'
  message?: string
  fieldErrors?: Record<string, string[]>
  /** Shown once, so an operator can pass the link on while email is stubbed. */
  acceptUrl?: string
}

const inviteSchema = z.object({
  email: z.email('Enter a valid email address').max(200),
  displayName: z.string().trim().min(2, 'Enter their name').max(120),
  jobTitle: z.string().trim().max(120).optional(),
  roleKey: z.enum([
    'employee',
    'shift_lead',
    'scheduler',
    'general_manager',
    'training_manager',
    'hr_admin',
    'owner',
  ]),
  scope: z.enum(['org', 'location']),
  locationId: z.union([z.uuid(), z.literal('')]),
})

export async function sendInvitationAction(
  _previous: InviteActionState,
  formData: FormData,
): Promise<InviteActionState> {
  const { actor } = await requireActorContext()

  const parsed = inviteSchema.safeParse({
    email: formData.get('email'),
    displayName: formData.get('displayName'),
    jobTitle: formData.get('jobTitle') ?? '',
    roleKey: formData.get('roleKey'),
    scope: formData.get('scope'),
    locationId: formData.get('locationId') ?? '',
  })

  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Please check the highlighted fields.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  if (parsed.data.scope === 'location' && !parsed.data.locationId) {
    return {
      status: 'error',
      message: 'Choose the location this person works at.',
      fieldErrors: { locationId: ['Choose a location.'] },
    }
  }

  try {
    const issued = await withTenant(actor.organizationId, (tx) =>
      createInvitation(
        tx,
        actor,
        {
          email: parsed.data.email,
          displayName: parsed.data.displayName,
          jobTitle: parsed.data.jobTitle,
          roleKey: parsed.data.roleKey,
          scope: parsed.data.scope,
          scopeLocationId: parsed.data.locationId || null,
          homeLocationId: parsed.data.locationId || null,
          locationIds: parsed.data.locationId ? [parsed.data.locationId] : [],
          jobRoleIds: [],
        },
        getEnv().APP_URL,
      ),
    )

    await emailProvider().send({
      to: parsed.data.email,
      subject: `You have been invited to join on EverCalm`,
      text:
        `${parsed.data.displayName},\n\n` +
        `You have been invited to join your team on EverCalm.\n\n` +
        `Accept your invitation: ${issued.acceptUrl}\n\n` +
        `This link works once and expires on ${issued.expiresAt.toDateString()}.`,
    })

    revalidatePath('/app/people/invitations')
    revalidatePath('/app/people')
    revalidatePath('/app')

    return {
      status: 'success',
      message: `Invitation created for ${parsed.data.displayName}.`,
      acceptUrl: issued.acceptUrl,
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      return { status: 'error', message: error.message, fieldErrors: error.fieldErrors }
    }
    if (error instanceof ForbiddenError) {
      return { status: 'error', message: 'You do not have permission to invite people.' }
    }
    if (error instanceof NotFoundError) {
      return { status: 'error', message: 'That role or location does not exist here.' }
    }
    return { status: 'error', message: 'We could not create that invitation.' }
  }
}

export async function invitationLifecycleAction(
  _previous: InviteActionState,
  formData: FormData,
): Promise<InviteActionState> {
  const { actor } = await requireActorContext()
  const invitationId = readString(formData, 'invitationId', '')
  const intent = readString(formData, 'intent', '')

  try {
    if (intent === 'revoke') {
      await withTenant(actor.organizationId, (tx) => revokeInvitation(tx, actor, invitationId))
      revalidatePath('/app/people/invitations')
      return { status: 'success', message: 'Invitation revoked. Any outstanding link now fails.' }
    }

    if (intent === 'resend') {
      const issued = await withTenant(actor.organizationId, (tx) =>
        resendInvitation(tx, actor, invitationId, getEnv().APP_URL),
      )
      await emailProvider().send({
        to: 'invitee',
        subject: 'Your EverCalm invitation',
        text: `Accept your invitation: ${issued.acceptUrl}`,
      })
      revalidatePath('/app/people/invitations')
      return {
        status: 'success',
        message: 'A new link has been issued. The previous one no longer works.',
        acceptUrl: issued.acceptUrl,
      }
    }

    return { status: 'error', message: 'Unknown action.' }
  } catch (error) {
    if (error instanceof ValidationError) {
      return { status: 'error', message: error.message }
    }
    if (error instanceof ForbiddenError) {
      return { status: 'error', message: 'You do not have permission to do that.' }
    }
    return { status: 'error', message: 'We could not update that invitation.' }
  }
}
