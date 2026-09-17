/**
 * Line icons for the launchers: one stroke weight, one 24px grid, drawn in
 * currentColor so the tile decides the colour. Decorative - the card's label
 * always names the tool.
 */

export type ToolIconName =
  | 'people'
  | 'onboarding'
  | 'calendar'
  | 'book'
  | 'checklist'
  | 'megaphone'
  | 'document'
  | 'settings'
  | 'clock'
  | 'inbox'
  | 'next'
  | 'support'
  | 'alert'
  | 'plus'

const common = {
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export function ToolIcon({
  name,
  className = 'size-6',
}: {
  name: ToolIconName
  className?: string
}) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className={className}>
      {PATHS[name]}
    </svg>
  )
}

const PATHS: Record<ToolIconName, React.ReactNode> = {
  people: (
    <>
      <circle cx="9" cy="8.5" r="3.2" {...common} />
      <path d="M3.5 19.5c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" {...common} />
      <path d="M15.5 5.6a3 3 0 0 1 0 5.8M17.5 14.8c1.7.6 2.8 2.2 3.1 4.7" {...common} />
    </>
  ),
  onboarding: (
    <>
      <circle cx="10" cy="8" r="3.2" {...common} />
      <path d="M4 19.5c.6-3.2 2.9-5 6-5 1.3 0 2.5.3 3.4.9" {...common} />
      <path d="M18 14v6M15 17h6" {...common} />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5.5" width="16" height="14.5" rx="2" {...common} />
      <path d="M8 3.5v4M16 3.5v4M4 10h16" {...common} />
      <path d="M8.5 14h2M13.5 14h2M8.5 17h2" {...common} />
    </>
  ),
  book: (
    <path
      d="M5 5.5A1.5 1.5 0 0 1 6.5 4H19v14H6.5A1.5 1.5 0 0 0 5 19.5v-14ZM5 19.5A1.5 1.5 0 0 0 6.5 21H19M9 8h6"
      {...common}
    />
  ),
  checklist: (
    <>
      <rect x="5" y="3.5" width="14" height="17" rx="2" {...common} />
      <path d="m8.5 9 1.5 1.5 3-3M8.5 15l1.5 1.5 3-3" {...common} />
    </>
  ),
  megaphone: (
    <>
      <path d="M4 10v4a1 1 0 0 0 1 1h2l8 4.5v-15L7 9H5a1 1 0 0 0-1 1Z" {...common} />
      <path d="M8 15.5 9.5 20M18.5 9.5a3.5 3.5 0 0 1 0 5" {...common} />
    </>
  ),
  document: (
    <>
      <path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20V3.5Z" {...common} />
      <path d="M14 3.5V8h4M9.5 12.5h5M9.5 16h5" {...common} />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" {...common} />
      <path
        d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M6 18l1.4-1.4M16.6 7.4 18 6"
        {...common}
      />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" {...common} />
      <path d="M12 7.5V12l3 2" {...common} />
    </>
  ),
  inbox: (
    <>
      <path d="M4 13.5 6.5 5h11l2.5 8.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5.5Z" {...common} />
      <path d="M4 13.5h4.5l1 2h5l1-2H20" {...common} />
    </>
  ),
  next: (
    <>
      <circle cx="12" cy="12" r="8.5" {...common} />
      <path d="M10 8.5 13.5 12 10 15.5" {...common} />
    </>
  ),
  support: (
    <>
      <circle cx="12" cy="12" r="8.5" {...common} />
      <path d="M9.8 9.6a2.3 2.3 0 1 1 3.2 2.1c-.6.3-1 .8-1 1.5v.3M12 16.6v.1" {...common} />
    </>
  ),
  alert: (
    <>
      <path d="M12 4 21 19.5H3L12 4Z" {...common} />
      <path d="M12 10v4M12 16.8v.1" {...common} />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" {...common} />,
}
