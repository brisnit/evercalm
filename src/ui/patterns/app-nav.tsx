'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useId, useState } from 'react'
import { cn } from '@/lib/cn'

/**
 * The top navigation of the administration and EverCalm team shells.
 *
 * One `<nav>` at every width, so there is exactly one landmark with the
 * section list. From the lg breakpoint the list is a single row; below it the
 * list sits behind a "Menu" button that names the current section, so the
 * page's own content starts on the first screen of a phone instead of after
 * three rows of links.
 *
 * The current section is marked with `aria-current="page"` as well as weight
 * and a sage rule on the navy band, so position never depends on colour alone.
 */
export function AppNav({
  label,
  items,
  exact = [],
  menuFooter,
}: {
  label: string
  items: { href: string; label: string }[]
  /** Hrefs that match only themselves (the section home, e.g. /app). */
  exact?: string[]
  /**
   * Account controls for the phone menu. On a wide screen they sit in the
   * header row; there is no room for them there on a phone, and burying them
   * in the menu the person already opened beats shrinking them to nothing.
   */
  menuFooter?: React.ReactNode
}) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const listId = useId()

  useEffect(() => setOpen(false), [pathname])

  const isCurrent = (href: string) =>
    exact.includes(href) ? pathname === href : pathname === href || pathname.startsWith(`${href}/`)
  const current = items.find((item) => isCurrent(item.href))

  return (
    <nav aria-label={label} className="border-band-line border-t">
      <div className="mx-auto w-full max-w-6xl px-3">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((value) => !value)}
          className="rounded-control flex min-h-11 w-full items-center gap-2 px-2 text-sm font-medium text-white hover:bg-white/10 lg:hidden"
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="size-4">
            {open ? (
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            ) : (
              <path
                d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            )}
          </svg>
          Menu
          {current ? (
            <span className="text-band-quiet min-w-0 truncate font-normal">· {current.label}</span>
          ) : null}
        </button>

        <ul
          id={listId}
          className={cn(
            'gap-x-1 pb-2 lg:flex lg:flex-wrap lg:pb-0',
            open ? 'grid grid-cols-2' : 'hidden',
          )}
        >
          {items.map((item) => {
            const active = isCurrent(item.href)
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'rounded-control relative flex min-h-11 items-center px-3 text-sm transition-colors',
                    "lg:after:absolute lg:after:inset-x-3 lg:after:bottom-0 lg:after:h-0.5 lg:after:rounded-full lg:after:content-['']",
                    active
                      ? 'lg:after:bg-sage-400 bg-white/10 font-semibold text-white lg:bg-transparent'
                      : 'text-band-quiet hover:bg-white/10 hover:text-white',
                  )}
                >
                  {item.label}
                </Link>
              </li>
            )
          })}
        </ul>

        {menuFooter && open ? (
          <div className="border-band-line mt-1 border-t pt-2 pb-2 lg:hidden">{menuFooter}</div>
        ) : null}
      </div>
    </nav>
  )
}
