'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/cn'

/**
 * Sub-navigation within a section.
 *
 * The current page is marked with aria-current, not only a colour, so the
 * position is available to a screen reader as well as to the eye.
 */
export function SectionNav({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname()

  return (
    <nav aria-label="Section" className="border-line border-b">
      <ul className="-mb-px flex flex-wrap gap-x-1 overflow-x-auto">
        {items.map((item) => {
          const active = pathname === item.href
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-11 items-center border-b-2 px-3 text-sm whitespace-nowrap',
                  active
                    ? 'text-ink border-violet-600 font-semibold'
                    : 'text-muted hover:border-line-strong hover:text-ink border-transparent',
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
