'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/cn'
import { ToolIcon, type ToolIconName } from './tool-icon'

/**
 * The manager's bottom bar, on phones only.
 *
 * A manager reads this standing on the floor with one hand, so the five places
 * they go most often are in thumb reach. Everything else stays in the Menu on
 * the band above — this bar is a shortcut, never the only way to a section.
 * Sections the person cannot open are not shown, so the bar never offers a
 * door that is locked.
 */

const BAR: { href: string; label: string; icon: ToolIconName; match: (p: string) => boolean }[] = [
  { href: '/app', label: 'Home', icon: 'home', match: (p) => p === '/app' },
  {
    href: '/app/people',
    label: 'People',
    icon: 'people',
    match: (p) => p.startsWith('/app/people'),
  },
  {
    href: '/app/onboarding',
    label: 'Onboard',
    icon: 'onboarding',
    match: (p) => p.startsWith('/app/onboarding'),
  },
  {
    href: '/app/schedule',
    label: 'Schedule',
    icon: 'calendar',
    match: (p) => p.startsWith('/app/schedule'),
  },
  {
    href: '/app/comms',
    label: 'Messages',
    icon: 'megaphone',
    match: (p) => p.startsWith('/app/comms'),
  },
]

export function ManagerNav({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname()
  const allowed = new Set(items.map((item) => item.href))
  const bar = BAR.filter((item) => allowed.has(item.href))
  if (bar.length < 2) return null

  return (
    <nav
      aria-label="Sections"
      className="bg-band border-band-line fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="mx-auto flex max-w-lg">
        {bar.map((item) => {
          const active = item.match(pathname)
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-14 flex-col items-center justify-center gap-1 px-1 text-[0.6875rem] font-medium transition-colors',
                  active ? 'text-sage-300' : 'text-band-quiet hover:text-white',
                )}
              >
                <ToolIcon name={item.icon} className="size-[1.375rem]" />
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
