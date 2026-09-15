'use client'

import { useActionState } from 'react'
import type { ActionState } from '@/modules/people/actions'
import { cn } from '@/lib/cn'
import { Button } from '@/ui/primitives'
import { useShowNotice } from './notice-provider'

const IDLE: ActionState = { status: 'idle' }

/**
 * A small form bound to a server action, for pages full of them.
 *
 * Success is handed to the surrounding NoticeProvider (the form's subject
 * usually moves or disappears on success); an error stays here, next to the
 * control that caused it, announced with role="alert".
 */
export function MiniForm({
  action,
  hidden,
  submitLabel,
  variant = 'secondary',
  size = 'md',
  fullWidth = false,
  className,
  children,
}: {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>
  hidden: Record<string, string | number>
  submitLabel: string
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  fullWidth?: boolean
  className?: string
  children?: React.ReactNode | ((state: ActionState) => React.ReactNode)
}) {
  const show = useShowNotice()
  const [state, formAction, pending] = useActionState(
    async (previous: ActionState, formData: FormData) => {
      const result = await action(previous, formData)
      if (result.status === 'success') show(result)
      return result
    },
    IDLE,
  )

  return (
    <form action={formAction} className={cn('flex flex-col gap-3', className)}>
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {typeof children === 'function' ? children(state) : children}
      {state.status === 'error' && state.message ? (
        <p role="alert" className="text-danger text-sm font-medium">
          {state.message}
        </p>
      ) : null}
      <Button
        type="submit"
        variant={variant}
        size={size}
        loading={pending}
        className={fullWidth ? 'w-full' : 'self-start'}
      >
        {submitLabel}
      </Button>
    </form>
  )
}
