'use client'

import { useId, useState } from 'react'
import { cn } from '@/lib/cn'

/**
 * A show/hide section.
 *
 * Deliberately NOT `<details>/<summary>`. That element looks like the right
 * answer and mostly is, but a collapsed `<summary>` is exposed to the
 * accessibility tree as a generic node rather than a button with expanded
 * state - so assistive technology does not announce that it can be opened,
 * and neither `getByRole('button')` nor `getByRole('group')` finds it. That
 * cost us a test-authoring hunt in Slice 2 and again in Slice 3.
 *
 * A button with `aria-expanded` and `aria-controls` says exactly what it is,
 * to a screen reader and to a test.
 */
export function Disclosure({
  label,
  count,
  children,
  defaultOpen = false,
  className,
}: {
  label: string
  /** Shown next to the label; also announced, so it is not decoration. */
  count?: number
  children: React.ReactNode
  defaultOpen?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()

  return (
    <div className={cn('border-line/70 rounded-control border', className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={() => setOpen((value) => !value)}
        className="text-ink rounded-control flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm font-medium hover:bg-violet-50/60"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          fill="none"
          className={cn(
            'text-muted size-4 shrink-0 transition-transform motion-reduce:transition-none',
            open && 'rotate-90',
          )}
        >
          <path
            d="M6 3.5 10.5 8 6 12.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {label}
        {count !== undefined ? <span className="text-faint text-xs">({count})</span> : null}
      </button>

      <div id={`${id}-panel`} hidden={!open} className="px-3 pt-1 pb-3">
        {children}
      </div>
    </div>
  )
}
