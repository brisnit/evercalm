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
  // Nothing to act on reads as calm, not as a competing number.
  const quiet = value === 0 || value === '0' || value === '0%'
  const effective = quiet && tone !== 'good' ? 'neutral' : tone

  const mark = {
    neutral: 'before:bg-transparent',
    attention: 'before:bg-warning',
    urgent: 'before:bg-danger',
    good: 'before:bg-transparent',
  }[effective]

  const valueTone = quiet
    ? 'text-faint'
    : {
        neutral: 'text-ink',
        attention: 'text-warning',
        urgent: 'text-danger',
        good: 'text-success',
      }[effective]

  return (
    <Link
      href={href}
      className={cn(
        'group rounded-card border-line relative flex flex-col gap-0.5 overflow-hidden border bg-white p-4 pl-5',
        "before:absolute before:inset-y-0 before:left-0 before:w-1 before:content-['']",
        'hover:shadow-lift focus-visible:shadow-lift transition-[box-shadow,border-color] hover:border-teal-300',
        mark,
      )}
    >
      <span className="text-muted text-[0.8125rem] font-medium">{label}</span>
      <span
        className={cn(
          'font-display text-[1.75rem] leading-tight font-extrabold tabular-nums',
          valueTone,
        )}
      >
        {value}
      </span>
      <span className="text-muted group-hover:text-ink text-sm">{detail}</span>
    </Link>
  )
}
