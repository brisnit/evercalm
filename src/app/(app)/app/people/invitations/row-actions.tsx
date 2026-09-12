'use client'

import { useActionState } from 'react'
import { invitationLifecycleAction, type InviteActionState } from '@/modules/invitations/actions'
import { Button } from '@/ui/primitives'

const INITIAL: InviteActionState = { status: 'idle' }

/**
 * Resend and revoke.
 *
 * Resending issues a NEW token, which is why the confirmation says the old
 * link stops working - a manager resending because "they never got it" needs
 * to know the first link is now dead.
 */
export function InvitationRowActions({
  invitationId,
  canResend,
}: {
  invitationId: string
  canResend: boolean
}) {
  const [state, formAction, pending] = useActionState(invitationLifecycleAction, INITIAL)

  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex flex-wrap gap-2">
        {canResend ? (
          <form action={formAction}>
            <input type="hidden" name="invitationId" value={invitationId} />
            <input type="hidden" name="intent" value="resend" />
            <Button type="submit" size="sm" variant="secondary" loading={pending}>
              Resend
            </Button>
          </form>
        ) : null}
        <form action={formAction}>
          <input type="hidden" name="invitationId" value={invitationId} />
          <input type="hidden" name="intent" value="revoke" />
          <Button type="submit" size="sm" variant="ghost" loading={pending}>
            Revoke
          </Button>
        </form>
      </div>

      {state.status !== 'idle' && state.message ? (
        <p
          role="status"
          className={
            state.status === 'success'
              ? 'text-success max-w-xs text-xs'
              : 'text-danger max-w-xs text-xs font-medium'
          }
        >
          {state.message}
        </p>
      ) : null}
    </div>
  )
}
