'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/cn'

/**
 * Employee navigation: the five places an employee goes, always one tap away.
 *
 * On a phone it is a bar fixed to the bottom of the screen, where a thumb
 * reaches; from the md breakpoint the same links sit in the header instead.
 * Only one of the two is ever displayed, so there is one landmark at a time.
 */

const ITEMS = [
  { href: '/my', label: 'Home', match: (p: string) => p === '/my', icon: 'home' },
  {
    href: '/my/schedule',
    label: 'Schedule',
    match: (p: string) => /^\/my\/(schedule|time-off|availability)(\/|$)/.test(p),
    icon: 'calendar',
  },
  {
    href: '/my/shift',
    label: 'Shift',
    match: (p: string) => p.startsWith('/my/shift'),
    icon: 'check',
  },
  {
    href: '/my/training',
    label: 'Training',
    match: (p: string) => p.startsWith('/my/training'),
    icon: 'book',
  },
  {
    href: '/my/inbox',
    label: 'Inbox',
    match: (p: string) => p.startsWith('/my/inbox'),
    icon: 'inbox',
  },
] as const

function Icon({ name }: { name: (typeof ITEMS)[number]['icon'] }) {
  const common = {
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="size-[1.375rem]">
      {name === 'home' ? (
        <path
          d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1v-8.5Z"
          {...common}
        />
      ) : null}
      {name === 'calendar' ? (
        <>
          <rect x="4" y="5.5" width="16" height="14.5" rx="2" {...common} />
          <path d="M8 3.5v4M16 3.5v4M4 10h16" {...common} />
        </>
      ) : null}
      {name === 'check' ? (
        <>
          <rect x="5" y="3.5" width="14" height="17" rx="2" {...common} />
          <path d="m9 12 2 2 4-4.5" {...common} />
        </>
      ) : null}
      {name === 'book' ? (
        <path
          d="M5 5.5A1.5 1.5 0 0 1 6.5 4H19v14H6.5A1.5 1.5 0 0 0 5 19.5v-14ZM5 19.5A1.5 1.5 0 0 0 6.5 21H19"
          {...common}
        />
      ) : null}
      {name === 'inbox' ? (
        <>
          <path d="M4 13.5 6.5 5h11l2.5 8.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5.5Z" {...common} />
          <path d="M4 13.5h4.5l1 2h5l1-2H20" {...common} />
        </>
      ) : null}
    </svg>
  )
}

export function EmployeeNav({ variant }: { variant: 'bar' | 'inline' }) {
  const pathname = usePathname()

  if (variant === 'inline') {
    return (
      <nav aria-label="Your work" className="hidden md:block">
        <ul className="flex items-center gap-1">
          {ITEMS.map((item) => {
            const active = item.match(pathname)
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'rounded-control inline-flex min-h-11 items-center px-3 text-sm transition-colors',
                    active
                      ? 'text-ink bg-teal-50 font-semibold'
                      : 'text-muted hover:text-ink hover:bg-teal-50/70',
                  )}
                >
                  {item.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    )
  }

  return (
    <nav
      aria-label="Your work"
      className="border-line fixed inset-x-0 bottom-0 z-40 border-t bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="mx-auto grid max-w-xl grid-cols-5">
        {ITEMS.map((item) => {
          const active = item.match(pathname)
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-[0.6875rem] font-medium transition-colors',
                  "before:absolute before:top-0 before:h-0.5 before:w-8 before:rounded-full before:content-['']",
                  active
                    ? 'text-teal-700 before:bg-teal-600'
                    : 'text-muted hover:text-ink before:bg-transparent',
                )}
              >
                <Icon name={item.icon} />
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
