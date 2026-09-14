'use client'

import { useActionState, useCallback, useRef } from 'react'
import type { ScheduleActionState } from '@/modules/scheduling/actions'
import { Button } from '@/ui/primitives'

const INITIAL: ScheduleActionState = { status: 'idle' }

/**
 * A two-way decision: one note, and the button pressed says which way.
 *
 * The request disappears from the pending list when it is decided, so a
 * success is handed to the parent's notice from inside the action rather than
 * rendered here (see src/ui/patterns/action-form.tsx).
 */
export function DecisionForm({
  action,
  hidden,
  approve,
  reject,
  noteLabel = 'Note (optional)',
  onSuccess,
  idPrefix,
}: {
  action: (previous: ScheduleActionState, formData: FormData) => Promise<ScheduleActionState>
  hidden: Record<string, string>
  approve: { value: string; label: string }
  /** Omit when only one outcome is possible. */
  reject?: { value: string; label: string }
  noteLabel?: string
  onSuccess: (state: ScheduleActionState) => void
  idPrefix: string
}) {
  const onSuccessRef = useRef(onSuccess)
  onSuccessRef.current = onSuccess
  const run = useCallback(
    async (previous: ScheduleActionState, formData: FormData) => {
      const result = await action(previous, formData)
      if (result.status === 'success') onSuccessRef.current(result)
      return result
    },
    [action],
  )
  const [state, formAction, pending] = useActionState(run, INITIAL)

  return (
    <form action={formAction} className="flex flex-col gap-2.5">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {state.status === 'error' && state.message ? (
        <p
          role="alert"
          className="rounded-control border-danger/30 bg-danger-soft text-danger border px-3 py-2 text-sm font-medium"
        >
          {state.message}
        </p>
      ) : null}
      <label htmlFor={`${idPrefix}-note`} className="text-muted text-xs font-medium">
        {noteLabel}
      </label>
      <input
        id={`${idPrefix}-note`}
        name="note"
        maxLength={500}
        className="rounded-control border-line-strong text-ink min-h-11 w-full border bg-white px-3 text-sm"
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="decision" value={approve.value} loading={pending} size="sm">
          {approve.label}
        </Button>
        {reject ? (
          <Button
            type="submit"
            name="decision"
            value={reject.value}
            variant="secondary"
            disabled={pending}
            size="sm"
          >
            {reject.label}
          </Button>
        ) : null}
      </div>
    </form>
  )
}
