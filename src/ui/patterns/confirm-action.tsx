'use client'

import { useState } from 'react'
import { Button } from '@/ui/primitives'

/**
 * A destructive action behind a deliberate confirmation.
 *
 * Uses a native <details>-free disclosure so it works without JavaScript
 * hydration quirks, keeps focus where the user left it, and states plainly
 * what will happen before anything does.
 */
export function ConfirmAction({
  triggerLabel,
  title,
  description,
  children,
}: {
  triggerLabel: string
  title: string
  description: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {triggerLabel}
      </Button>
    )
  }

  return (
    <div className="rounded-card border-danger/30 bg-danger-soft/40 border p-4">
      <h3 className="font-display text-ink text-sm font-bold">{title}</h3>
      <p className="text-muted mt-1.5 mb-3 text-sm">{description}</p>
      {children}
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-muted hover:text-ink mt-3 text-sm underline underline-offset-4"
      >
        Cancel
      </button>
    </div>
  )
}
