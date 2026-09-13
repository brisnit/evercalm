/**
 * Line icons for the capability grid.
 *
 * Drawn here rather than pulled from a package: twelve 20px glyphs on one
 * marketing page do not justify a dependency, and these share one stroke
 * weight so the grid reads as a set.
 */

const BASE = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

export type IconName =
  | 'onboarding'
  | 'training'
  | 'skills'
  | 'scheduling'
  | 'availability'
  | 'swaps'
  | 'announcements'
  | 'policies'
  | 'checklists'
  | 'preshift'
  | 'performance'
  | 'locations'
  | 'clock'
  | 'check'
  | 'arrow'
  | 'info'
  | 'shield'
  | 'badge'

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg {...BASE} className={className}>
      {PATHS[name]}
    </svg>
  )
}

const PATHS: Record<IconName, React.ReactNode> = {
  onboarding: (
    <>
      <path d="M15 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-4A3.5 3.5 0 0 0 4 18.5V20" />
      <circle cx="9.5" cy="8" r="3.2" />
      <path d="M17 7h5M19.5 4.5v5" />
    </>
  ),
  training: (
    <>
      <path d="M12 4 3 8.5l9 4.5 9-4.5z" />
      <path d="M6.5 10.7v4.6c0 1.5 2.6 2.7 5.5 2.7s5.5-1.2 5.5-2.7v-4.6" />
    </>
  ),
  skills: (
    <>
      <circle cx="12" cy="8.5" r="4.5" />
      <path d="M9 12.5 8 21l4-2.2L16 21l-1-8.5" />
    </>
  ),
  scheduling: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 10h17M8 3.5v3M16 3.5v3" />
    </>
  ),
  availability: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  swaps: (
    <>
      <path d="M4 8h13l-3-3M20 16H7l3 3" />
    </>
  ),
  announcements: (
    <>
      <path d="M4 10v4a1.5 1.5 0 0 0 1.5 1.5H8l5.5 4V6L8 10z" />
      <path d="M17.5 9.5a4 4 0 0 1 0 5" />
    </>
  ),
  policies: (
    <>
      <path d="M12 3.5 5 6v6c0 4 3 7.2 7 8.5 4-1.3 7-4.5 7-8.5V6z" />
      <path d="M9.2 12.2 11 14l4-4.2" />
    </>
  ),
  checklists: (
    <>
      <rect x="5" y="3.5" width="14" height="17" rx="2.5" />
      <path d="M9 9h6M9 13h6M9 17h3" />
    </>
  ),
  preshift: (
    <>
      <path d="M3.5 17h17" />
      <path d="M7 17a5 5 0 0 1 10 0" />
      <path d="M12 4.5v2M5.5 7.5 7 9M18.5 7.5 17 9" />
    </>
  ),
  performance: (
    <>
      <path d="M4 20V11M10 20V5M16 20v-6M22 20H2" />
    </>
  ),
  locations: (
    <>
      <path d="M12 21s6.5-5.6 6.5-10.3a6.5 6.5 0 0 0-13 0C5.5 15.4 12 21 12 21z" />
      <circle cx="12" cy="10.5" r="2.4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  check: <path d="M5 12.5 10 17.5 19 7" />,
  arrow: (
    <>
      <path d="M5 12h13M13 6.5 18.5 12 13 17.5" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.5 5 6v6c0 4 3 7.2 7 8.5 4-1.3 7-4.5 7-8.5V6z" />
    </>
  ),
  badge: (
    <>
      <circle cx="12" cy="9" r="5" />
      <path d="M8.5 13.5 7.5 21l4.5-2.4L16.5 21l-1-7.5" />
    </>
  ),
}
