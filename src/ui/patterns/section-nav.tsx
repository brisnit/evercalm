'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/cn'

/**
 * Sub-navigation within a section.
 *
 * Round 2 puts it on the navy band, directly above the page title, as a group
 * of pills: the two are one continuous band, so a section reads as one place
 * rather than a strip of tabs sitting on top of a header.
 *
 * The current page is marked with aria-current, not only a colour, so the
 * position is available to a screen reader as well as to the eye.
 */
export function SectionNav({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname()

  // The shortest href is the section's own page; it matches only itself, so a
  // child route like /app/schedule/templates/new lights up Templates rather
  // than Week.
  const root = items.reduce(
    (shortest, item) => (item.href.length < shortest.length ? item.href : shortest),
    items[0]?.href ?? '',
  )
  const isCurrent = (href: string) =>
    href === root ? pathname === href : pathname === href || pathname.startsWith(`${href}/`)

  return (
    <nav aria-label="Section" className="full-bleed bg-band text-white">
      <div className="pt-6 sm:pt-8">
        {/* One row that scrolls on a phone rather than wrapping into several. */}
        <ul className="flex w-fit max-w-full [scrollbar-width:none] gap-1 overflow-x-auto rounded-full bg-white/10 p-1">
          {items.map((item) => {
            const active = isCurrent(item.href)
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'inline-flex min-h-9 items-center rounded-full px-4 text-sm whitespace-nowrap transition-colors',
                    active
                      ? 'text-ink bg-white font-semibold'
                      : 'text-band-quiet hover:bg-white/10 hover:text-white',
                  )}
                >
                  {item.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
    </nav>
  )
}
