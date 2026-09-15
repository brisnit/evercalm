'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useId, useState } from 'react'

/**
 * The public navigation below 1024px, where the inline links do not fit. The
 * links stay in the document (hidden, not removed), so they remain real links
 * that resolve to real sections.
 */
export function MarketingMobileNav({ items }: { items: { href: string; label: string }[] }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const pathname = usePathname()
  useEffect(() => setOpen(false), [pathname])

  return (
    <div
      className="lg:hidden"
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false)
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="text-deep hover:bg-lift inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full px-2.5 text-sm font-medium sm:px-3"
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
        {/* Icon only on the narrowest phones, where the header has no room for the word. */}
        <span className="sr-only sm:not-sr-only">Menu</span>
      </button>
      <div
        id={id}
        hidden={!open}
        className="border-line/60 absolute inset-x-0 top-full border-b bg-white shadow-[0_18px_30px_-20px_rgb(23_18_64/0.35)]"
      >
        <ul className="mx-auto grid w-full max-w-[1168px] gap-1 px-5 py-3 sm:grid-cols-2">
          {items.map((item) => (
            <li key={item.label}>
              <Link
                href={item.href}
                onClick={() => setOpen(false)}
                className="text-deep hover:bg-lift flex min-h-11 items-center rounded-xl px-3 text-[0.9375rem] font-medium"
              >
                {item.label}
              </Link>
            </li>
          ))}
          <li>
            <Link
              href="/signin"
              onClick={() => setOpen(false)}
              className="text-deep hover:bg-lift flex min-h-11 items-center rounded-xl px-3 text-[0.9375rem] font-medium sm:hidden"
            >
              Sign in
            </Link>
          </li>
        </ul>
      </div>
    </div>
  )
}
