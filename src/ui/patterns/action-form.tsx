'use client'

import { useActionState, useCallback, useRef } from 'react'
import type { ActionState } from '@/modules/people/actions'
import { Button } from '@/ui/primitives'

const INITIAL: ActionState = { status: 'idle' }

/**
 * A form bound to a server action, with the four states every mutation needs:
 * idle, pending, success, and error.
 *
 * The result is announced through `role="status"`, so a screen reader hears
 * the outcome rather than only seeing a colour change.
 *
 * `onSuccess` hands a successful result to a parent instead of showing it
 * here. Use it whenever success REMOVES this form from the page (publishing
 * removes the Publish card), or the message would vanish with it. See
 * action-notice.tsx.
 */
export function ActionForm({
  action,
  submitLabel,
  children,
  variant = 'primary',
  destructive = false,
  className,
  onSuccess,
  stickySubmit,
}: {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>
  submitLabel: string
  children?: React.ReactNode | ((state: ActionState) => React.ReactNode)
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  destructive?: boolean
  className?: string
  onSuccess?: (state: ActionState) => void
  /** Keep the submit button in view at the bottom of a long form. */
  stickySubmit?: { hint?: string }
}) {
  // Success is handed over from INSIDE the action, not from an effect after
  // render. When success removes this form, the result and the refreshed page
  // land in the same commit - the form is gone before any effect of its own
  // could run, and the message would never reach the parent.
  const onSuccessRef = useRef(onSuccess)
  onSuccessRef.current = onSuccess
  const run = useCallback(
    async (previous: ActionState, formData: FormData) => {
      const result = await action(previous, formData)
      if (result.status === 'success') onSuccessRef.current?.(result)
      return result
    },
    [action],
  )
  const [state, formAction, pending] = useActionState(run, INITIAL)

  const inlineMessage =
    state.status !== 'idle' && state.message && !(state.status === 'success' && onSuccess)

  return (
    <form action={formAction} className={className ?? 'flex flex-col gap-3'}>
      {inlineMessage ? (
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

      {stickySubmit ? (
        <div className="border-line sm:rounded-card sm:shadow-lift sticky bottom-0 z-20 -mx-5 mt-2 flex flex-wrap items-center justify-between gap-3 border-t bg-white/95 px-5 py-3 backdrop-blur sm:mx-0 sm:border">
          {stickySubmit.hint ? (
            <p className="text-muted min-w-0 text-sm">{stickySubmit.hint}</p>
          ) : (
            <span />
          )}
          <Button type="submit" loading={pending} variant={destructive ? 'danger' : variant}>
            {submitLabel}
          </Button>
        </div>
      ) : (
        <Button
          type="submit"
          loading={pending}
          variant={destructive ? 'danger' : variant}
          className="self-start"
        >
          {submitLabel}
        </Button>
      )}
    </form>
  )
}
