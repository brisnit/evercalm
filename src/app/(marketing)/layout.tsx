import Link from 'next/link'
import { Logo } from '@/ui/primitives'

/**
 * Public site shell.
 *
 * Slice 1 ships four real pages so the domain is live and demos can be
 * booked. The full multi-page site is scheduled after the core operating loop
 * works, so its screenshots show the real product rather than mockups.
 * Every link in this nav goes to a page that exists.
 */

const NAV = [
  { href: '/pricing', label: 'Pricing' },
  { href: '/security', label: 'Security' },
  { href: '/contact', label: 'Contact' },
]

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-line border-b bg-white">
        <nav
          aria-label="Primary"
          className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4"
        >
          <Link href="/" aria-label="EverCalm home" className="shrink-0">
            <Logo height={26} priority />
          </Link>
          <ul className="flex flex-1 flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="text-muted hover:text-ink">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
          <Link
            href="/signin"
            className="rounded-control text-ink hover:bg-sunk min-h-11 px-4 py-2.5 text-sm font-medium"
          >
            Sign in
          </Link>
        </nav>
      </header>

      <main id="main" className="flex-1">
        {children}
      </main>

      <footer className="border-line bg-raise border-t">
        <div className="text-muted mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-8 text-sm">
          <p>© {new Date().getFullYear()} EverCalm</p>
          <p className="font-editorial italic">Every person knows what comes next.</p>
        </div>
      </footer>
    </div>
  )
}
