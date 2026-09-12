'use server'

import { headers } from 'next/headers'
import { z } from 'zod'
import { ValidationError } from '@/lib/errors'
import { withTenant } from '@/server/db'
import { auth } from '@/server/auth'
import { recordSystemAuditEvent } from '@/server/audit'
import { resolveInvitationToken } from '@/server/auth/invitation-access'
import { acceptInvitation, invitationIdentity } from './service'

/**
 * ACCEPTING AN INVITATION.
 *
 * The only anonymous write path in EverCalm, so it is deliberately narrow:
 *
 *  1. The token resolves to an organization through the SECURITY DEFINER
 *     function - nothing else about it is discoverable.
 *  2. The email address comes from the INVITATION, never from the form. A
 *     holder of the link cannot claim a different address, and the page never
 *     reveals which address the invitation is for.
 *  3. Account creation and acceptance happen in sequence, and acceptance is
 *     guarded by a conditional update so a replayed or raced token produces
 *     one employment, not two.
 *  4. Every failure returns the same message. A used, revoked, expired, or
 *     invented token are indistinguishable from outside.
 */

export interface AcceptState {
  status: 'idle' | 'error'
  message?: string
  fieldErrors?: Record<string, string[]>
}

const INVALID = 'This invitation link is no longer valid. Ask your manager to send a new one.'

const acceptSchema = z.object({
  token: z.string().min(20),
  password: z.string().min(12, 'Use at least 12 characters').max(256, 'That password is too long'),
})

export async function acceptInvitationAction(
  _previous: AcceptState,
  formData: FormData,
): Promise<AcceptState> {
  const parsed = acceptSchema.safeParse({
    token: formData.get('token'),
    password: formData.get('password'),
  })
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Please check the form.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const preview = await resolveInvitationToken(parsed.data.token)
  if (!preview) return { status: 'error', message: INVALID }

  const identity = await withTenant(preview.organizationId, (tx) =>
    invitationIdentity(tx, preview.organizationId, parsed.data.token),
  )
  if (!identity) return { status: 'error', message: INVALID }

  try {
    // The address comes from the invitation, not from anything the browser sent.
    await auth().api.signUpEmail({
      body: {
        email: identity.email,
        password: parsed.data.password,
        name: identity.displayName,
      },
      headers: await headers(),
    })
  } catch {
    return {
      status: 'error',
      message:
        'We could not create your account. If you already have one, sign in first and open the link again.',
    }
  }

  const session = await auth().api.getSession({ headers: await headers() })
  if (!session?.user) return { status: 'error', message: INVALID }

  try {
    const result = await withTenant(preview.organizationId, async (tx) => {
      const accepted = await acceptInvitation(
        tx,
        preview.organizationId,
        parsed.data.token,
        session.user.id,
      )
      await recordSystemAuditEvent(tx, preview.organizationId, {
        action: 'invitation.accepted',
        summary: `${accepted.displayName} accepted their invitation and joined`,
        subjectType: 'employment',
        subjectId: accepted.employmentId,
        reason: 'Invitation acceptance',
      })
      return accepted
    })
    return { status: 'idle', message: result.organizationName }
  } catch (error) {
    if (error instanceof ValidationError) return { status: 'error', message: error.message }
    return { status: 'error', message: INVALID }
  }
}
