import { cn } from '@/lib/cn'
import type { AvailabilityState } from '@/modules/scheduling/availability-state'

/**
 * What somebody said about working these hours.
 *
 * The word is always written and a mark always drawn, so the four states are
 * distinguishable without colour: ✓ available, – not preferred, × unavailable,
 * and a lock for approved time off, which is the one that can never be
 * overridden.
 */

const MARK: Record<AvailabilityState, string> = {
  available: '✓',
  not_preferred: '–',
  unavailable: '×',
  time_off: '🔒',
}

const TONE: Record<AvailabilityState, string> = {
  available: 'bg-success-soft text-success border-success/25',
  not_preferred: 'bg-warning-soft text-warning border-warning/30',
  unavailable: 'bg-danger-soft text-danger border-danger/25',
  time_off: 'bg-sunk text-muted border-line-strong',
}

const SHORT: Record<AvailabilityState, string> = {
  available: 'Available',
  not_preferred: 'Not preferred',
  unavailable: 'Unavailable',
  time_off: 'Time off',
}

export function AvailabilityPill({
  state,
  compact = false,
  className,
}: {
  state: AvailabilityState
  compact?: boolean
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        TONE[state],
        className,
      )}
    >
      <span aria-hidden="true">{MARK[state]}</span>
      {compact ? <span className="sr-only">{SHORT[state]}</span> : SHORT[state]}
    </span>
  )
}

/** The legend under a dense grid, where the pills are compact. */
export function AvailabilityLegend() {
  const states: AvailabilityState[] = ['available', 'not_preferred', 'unavailable', 'time_off']
  return (
    <p className="text-muted flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
      {states.map((state) => (
        <span key={state} className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="font-semibold">
            {MARK[state]}
          </span>
          {SHORT[state]}
        </span>
      ))}
    </p>
  )
}
