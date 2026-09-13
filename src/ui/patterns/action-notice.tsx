'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ActionState } from '@/modules/people/actions'

/*
 * CONFIRMATION THAT OUTLIVES THE FORM THAT PRODUCED IT.
 *
 * Publishing an announcement or acknowledging one changes the page: the
 * "Publish" card and the "I have read this" button are no longer relevant, so
 * they are gone after the refresh - and a success message rendered INSIDE
 * them went with them, a fraction of a second after it appeared.
 *
 * The notice is therefore held by a component that stays mounted across the
 * refresh, and shown there until the person dismisses it or leaves the page.
 * It is client state only: it is never stored, so it cannot reappear on a
 * later visit, a reload, or for anybody else.
 *
 * Focus moves to it, because the control that had focus has just been
 * removed - otherwise a keyboard or screen-reader user is dropped at the top
 * of the document with no idea what happened.
 */

export interface Notice {
  message: string
  /** Changes on every result, so a repeated identical message is re-announced. */
  id: number
}

export function useActionNotice() {
  const [notice, setNotice] = useState<Notice | null>(null)
  const counter = useRef(0)

  const show = useCallback((state: ActionState) => {
    if (state.status !== 'success' || !state.message) return
    counter.current += 1
    setNotice({ message: state.message, id: counter.current })
  }, [])

  const dismiss = useCallback(() => setNotice(null), [])

  return { notice, show, dismiss }
}

export function ActionNotice({
  notice,
  onDismiss,
  className,
}: {
  notice: Notice | null
  onDismiss: () => void
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!notice || !ref.current) return
    ref.current.focus({ preventScroll: true })
    ref.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [notice])

  if (!notice) return null

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="status"
      data-testid="action-notice"
      className={
        'rounded-control border-success/30 bg-success-soft text-success flex items-start justify-between gap-3 border px-3.5 py-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ' +
        (className ?? '')
      }
    >
      <p className="min-w-0">{notice.message}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="text-success hover:bg-success/10 -my-1 -mr-1.5 min-h-8 shrink-0 rounded px-2 text-xs font-semibold underline-offset-4 hover:underline"
      >
        Dismiss
      </button>
    </div>
  )
}
