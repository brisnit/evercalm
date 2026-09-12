'use client'

import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { acceptInvitationAction, type AcceptState } from '@/modules/invitations/accept-action'
import { Button, Field, Input } from '@/ui/primitives'

const INITIAL: AcceptState = { status: 'idle' }

export function AcceptForm({
  token,
  organizationName,
}: {
  token: string
  organizationName: string
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(acceptInvitationAction, INITIAL)

  // On success the action returns idle with the organization name as its
  // message, and the session cookie is already set.
  useEffect(() => {
    if (state.status === 'idle' && state.message) {
      router.push('/my')
      router.refresh()
    }
  }, [state, router])

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />

      {state.status === 'error' && state.message ? (
        <p
          role="alert"
          data-testid="accept-error"
          className="rounded-control border-danger/30 bg-danger-soft text-danger border px-3 py-2.5 text-sm font-medium"
        >
          {state.message}
        </p>
      ) : null}

      <Field
        id="accept-password"
        label="Create a password"
        hint="At least 12 characters."
        required
        error={state.fieldErrors?.password?.[0]}
      >
        {(p) => (
          <Input
            {...p}
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
          />
        )}
      </Field>

      <Button type="submit" loading={pending} className="w-full">
        Join {organizationName}
      </Button>

      <p className="text-faint text-xs">
        By joining you get access to your own schedule, training, and tasks. Your manager decides
        what else you can see.
      </p>
    </form>
  )
}
