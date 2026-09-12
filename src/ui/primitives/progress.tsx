import { cn } from '@/lib/cn'

/**
 * Progress.
 *
 * Onboarding percentage is the number a new hire actually looks at, so it gets
 * a real treatment rather than a bar with a label. Both forms carry the value
 * as text: progress is never communicated by fill alone.
 */

export function ProgressBar({
  value,
  label,
  tone = 'violet',
  className,
}: {
  value: number
  label: string
  tone?: 'violet' | 'success' | 'warning' | 'danger'
  className?: string
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)))
  const fill = {
    violet: 'bg-violet-600',
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-danger',
  }[tone]

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-muted text-xs font-medium">{label}</span>
        <span className="text-ink text-xs font-semibold tabular-nums">{clamped}%</span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className="bg-sunk h-2 w-full overflow-hidden rounded-full"
      >
        <div
          className={cn('h-full rounded-full transition-[width] duration-300', fill)}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  )
}

/**
 * A compact ring for dashboards. The gradient is one of the three sanctioned
 * uses of the brand gradient in the product.
 */
export function ProgressRing({
  value,
  size = 52,
  label,
}: {
  value: number
  size?: number
  label: string
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)))
  const stroke = 5
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (clamped / 100) * circumference

  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      role="img"
      aria-label={`${label}: ${clamped}% complete`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <defs>
          <linearGradient id="ec-ring" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--color-violet-600)" />
            <stop offset="100%" stopColor="var(--color-pink-500)" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-sunk)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="url(#ec-ring)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="text-ink absolute text-[0.68rem] font-bold tabular-nums">{clamped}</span>
    </span>
  )
}
