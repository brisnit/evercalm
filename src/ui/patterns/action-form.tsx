'use client'

import { useActionState } from 'react'
import type { ActionState } from '@/modules/people/actions'
import { Button } from '@/ui/primitives'

const INITIAL: ActionState = { status: 'idle' }

/**
 * A form bound to a server action, with the four states every mutation needs:
 * idle, pending, success, and error.
 *
 * The result is announced through `role="status"`, so a screen reader hears
 * the outcome rather than only seeing a colour change.
 */
export function ActionForm({
  action,
  submitLabel,
  children,
  variant = 'primary',
  destructive = false,
  className,
}: {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>
  submitLabel: string
  children?: React.ReactNode | ((state: ActionState) => React.ReactNode)
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  destructive?: boolean
  className?: string
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL)

  return (
    <form action={formAction} className={className ?? 'flex flex-col gap-3'}>
      {state.status !== 'idle' && state.message ? (
        <p
          role="status"
          className={
            state.status === 'success'
              ? 'rounded-control border-success/30 bg-success-soft text-success border px-3 py-2.5 text-sm font-medium'
              : 'rounded-control border-danger/30 bg-danger-soft text-danger border px-3 py-2.5 text-sm font-medium'
          }
        >
          {state.message}
        </p>
      ) : null}

      {typeof children === 'function' ? children(state) : children}

      <Button
        type="submit"
        loading={pending}
        variant={destructive ? 'danger' : variant}
        className="self-start"
      >
        {submitLabel}
      </Button>
    </form>
  )
}
