import Link from 'next/link'
import { cn } from '@/lib/cn'

/**
 * A dashboard figure.
 *
 * Every tile here is something a person can ACT on, and links to where they
 * would act. A number with nowhere to go is a vanity metric and does not
 * belong on this dashboard.
 */
export function StatTile({
  label,
  value,
  detail,
  href,
  tone = 'neutral',
}: {
  label: string
  value: number | string
  detail: string
  href: string
  tone?: 'neutral' | 'attention' | 'urgent' | 'good'
}) {
  const accent = {
    neutral: 'border-line',
    attention: 'border-warning/40 bg-warning-soft/40',
    urgent: 'border-danger/40 bg-danger-soft/40',
    good: 'border-success/35 bg-success-soft/40',
  }[tone]

  const valueTone = {
    neutral: 'text-ink',
    attention: 'text-warning',
    urgent: 'text-danger',
    good: 'text-success',
  }[tone]

  return (
    <Link
      href={href}
      className={cn(
        'group rounded-card flex flex-col gap-1 border bg-white p-4',
        'hover:shadow-lift focus-visible:shadow-lift transition-shadow',
        accent,
      )}
    >
      <span className="text-muted text-xs font-semibold tracking-[0.08em] uppercase">{label}</span>
      <span className={cn('font-display text-3xl font-extrabold tabular-nums', valueTone)}>
        {value}
      </span>
      <span className="text-muted group-hover:text-ink text-sm">{detail}</span>
    </Link>
  )
}
