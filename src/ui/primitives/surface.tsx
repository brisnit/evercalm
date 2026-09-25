import Link from 'next/link'
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
    <Component
      className={cn('rounded-card border-line shadow-low min-w-0 border bg-white', className)}
    >
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
        <h2 className="font-display text-ink text-base font-bold text-balance">{title}</h2>
        {description ? <p className="text-muted mt-0.5 text-sm">{description}</p> : null}
      </div>
      {action}
    </div>
  )
}

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info'

const TONES: Record<Tone, string> = {
  neutral: 'bg-sunk text-muted border-line-strong',
  accent: 'bg-teal-50 text-teal-700 border-teal-200',
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
  back,
  title,
  accent,
  description,
  action,
}: {
  /** Real context the title needs, such as the location. Not the nav section. */
  eyebrow?: string
  /** The way up from a detail page. */
  back?: { href: string; label: string }
  title: string
  /** The second tone: rendered in coral after the title, on the same line. */
  accent?: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <header className="full-bleed bg-band text-white">
      <div className="py-8 sm:py-11">
        {back ? (
          <div className="mb-2">
            <Link
              href={back.href}
              className="text-band-quiet inline-flex min-h-11 items-center gap-1.5 text-sm font-medium transition-colors hover:text-white"
            >
              <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="size-4">
                <path
                  d="M10 3.5 5.5 8l4.5 4.5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {back.label}
            </Link>
          </div>
        ) : null}
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
          <div className="min-w-0">
            {eyebrow ? <p className="text-band-quiet text-sm font-medium">{eyebrow}</p> : null}
            <h1 className="font-display mt-1 text-[2rem] leading-[1.05] font-extrabold tracking-[-0.02em] text-balance sm:text-[2.75rem] lg:text-[3.25rem]">
              {title}
              {accent ? <span className="text-band-accent"> {accent}</span> : null}
            </h1>
            {description ? (
              <p className="text-band-quiet mt-3 max-w-[60ch] text-[0.9375rem] leading-relaxed">
                {description}
              </p>
            ) : null}
          </div>
          {action ? <div className="flex flex-wrap items-center gap-2.5">{action}</div> : null}
        </div>
      </div>
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
