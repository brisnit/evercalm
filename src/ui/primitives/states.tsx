import * as React from 'react'
import { cn } from '@/lib/cn'

/**
 * Empty, loading, and error states.
 *
 * These are primitives rather than ad-hoc markup so that every view has all
 * three by default. A view that renders data but has no empty state is an
 * incomplete view.
 */

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string
  description: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'rounded-card flex flex-col items-center gap-3 border border-dashed',
        'border-line-strong bg-raise px-6 py-12 text-center',
        className,
      )}
    >
      <h3 className="font-display text-ink text-base font-bold">{title}</h3>
      <p className="text-muted max-w-sm text-sm">{description}</p>
      {action}
    </div>
  )
}

export function ErrorState({
  title = 'Something went wrong',
  description,
  action,
}: {
  title?: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <div
      role="alert"
      className="rounded-card border-danger/30 bg-danger-soft flex flex-col items-start gap-3 border px-5 py-5"
    >
      <h3 className="font-display text-danger text-base font-bold">{title}</h3>
      <p className="text-ink/80 text-sm">{description}</p>
      {action}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn('rounded-control bg-sunk animate-pulse', className)} />
  )
}

/** Announces a loading region to assistive technology. */
export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-2 py-4">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-4 w-2/5" />
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="h-4 w-3/5" />
    </div>
  )
}
