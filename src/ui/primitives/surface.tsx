import * as React from 'react'
import { cn } from '@/lib/cn'

/**
 * Surfaces and labels.
 *
 * Border, fill and shadow are spent by role rather than stamped on every
 * block: most groupings are a bordered Card, and only the one thing that
 * needs lifting gets the shadow.
 */

export function Card({
  children,
  className,
  as: Component = 'div',
}: {
  children: React.ReactNode
  className?: string
  as?: 'div' | 'section' | 'article'
}) {
  return (
    <Component className={cn('rounded-card border-line border bg-white', className)}>
      {children}
    </Component>
  )
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="border-line flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
      <div className="min-w-0">
        <h2 className="font-display text-ink text-base font-bold">{title}</h2>
        {description ? <p className="text-muted mt-0.5 text-sm">{description}</p> : null}
      </div>
      {action}
    </div>
  )
}

type Tone = 'neutral' | 'violet' | 'success' | 'warning' | 'danger' | 'info'

const TONES: Record<Tone, string> = {
  neutral: 'bg-sunk text-muted border-line-strong',
  violet: 'bg-violet-50 text-violet-700 border-violet-200',
  success: 'bg-success-soft text-success border-success/25',
  warning: 'bg-warning-soft text-warning border-warning/25',
  danger: 'bg-danger-soft text-danger border-danger/25',
  info: 'bg-info-soft text-info border-info/25',
}

/**
 * Status badge. Always carries text - meaning is never conveyed by colour
 * alone, so an icon-only or colour-only state is not offered.
 */
export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: React.ReactNode
  tone?: Tone
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5',
        'text-xs font-medium whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 pb-6">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-faint text-xs font-semibold tracking-[0.1em] uppercase">{eyebrow}</p>
        ) : null}
        <h1 className="font-display text-ink mt-1 text-2xl font-extrabold tracking-tight text-balance sm:text-3xl">
          {title}
        </h1>
        {description ? <p className="text-muted mt-2 max-w-2xl">{description}</p> : null}
      </div>
      {action}
    </header>
  )
}

/**
 * A horizontally scrollable region.
 *
 * Wide content (tables, schedule grids) must scroll inside its own container
 * so the page body never scrolls sideways. A scrollable container is also a
 * keyboard trap unless it is focusable and named - axe flags this as
 * `scrollable-region-focusable`, and it matters most on a phone, where the
 * audit table genuinely overflows.
 */
export function ScrollArea({
  children,
  label,
  className,
}: {
  children: React.ReactNode
  label: string
  className?: string
}) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className={cn('overflow-x-auto', className)}>
      {children}
    </div>
  )
}
