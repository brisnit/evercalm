import Link from 'next/link'
import { Logo } from '@/ui/primitives'

/**
 * Public site shell.
 *
 * The navigation is the homepage's own table of contents: Platform, For teams,
 * Training, Industries and Rollout are the sections of `/`, so every item
 * lands somewhere real rather than promising a page that has not been built.
 * Pricing, security and contact are real pages and are reachable from the
 * footer.
 */

const NAV = [
  { href: '/#platform', label: 'Platform' },
  { href: '/#experiences', label: 'For teams' },
  { href: '/#training', label: 'Training' },
  { href: '/#industries', label: 'Industries' },
  { href: '/#rollout', label: 'Rollout' },
]

const FOOTER_COLUMNS = [
  {
    heading: 'Platform',
    links: [
      { href: '/#platform', label: 'Scheduling' },
      { href: '/#training', label: 'Training' },
      { href: '/#platform', label: 'Onboarding' },
      { href: '/#platform', label: 'Checklists' },
    ],
  },
  {
    heading: 'Industries',
    links: [
      { href: '/#industries', label: 'Restaurants' },
      { href: '/#industries', label: 'Salons & spas' },
      { href: '/#industries', label: 'Retail' },
      { href: '/#industries', label: 'Fitness' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { href: '/security', label: 'Security' },
      { href: '/#rollout', label: 'Rollout guide' },
      { href: '/pricing', label: 'Pricing' },
      { href: '/contact', label: 'Contact' },
    ],
  },
]

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="border-line/60 sticky top-0 z-40 border-b bg-white/90 backdrop-blur">
        <nav
          aria-label="Primary"
          className="mx-auto flex w-full max-w-[1168px] items-center gap-6 px-5 py-5"
        >
          <Link href="/" aria-label="EverCalm home" className="shrink-0">
            <Logo size="h-9 sm:h-15" eager />
          </Link>

          <ul className="hidden flex-1 items-center gap-7 text-sm font-medium lg:flex">
            {NAV.map((item) => (
              <li key={item.label}>
                <Link href={item.href} className="text-deep/80 hover:text-deep">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>

          <div className="ml-auto flex items-center gap-2 sm:gap-4">
            <Link href="/signin" className="text-deep/80 hover:text-deep text-sm font-medium">
              Sign in
            </Link>
            <Link
              href="/contact"
              className="bg-accent hover:bg-accent-strong inline-flex min-h-11 items-center rounded-full px-5 text-sm font-semibold text-white"
            >
              Ask about a pilot
            </Link>
          </div>
        </nav>
      </header>

      <main id="main" className="flex-1">
        {children}
      </main>

      <footer className="border-line/70 bg-lift border-t">
        <div className="mx-auto w-full max-w-[1168px] px-5 py-9">
          <div className="grid gap-8 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
            <div>
              <FooterLockup />
              <p className="text-muted mt-4 max-w-[16rem] text-sm">
                Employee management, training, and daily operations for shift-based businesses.
              </p>
            </div>

            {FOOTER_COLUMNS.map((column) => (
              <div key={column.heading}>
                <h2 className="text-faint font-mono text-[0.6875rem] tracking-[0.14em] uppercase">
                  {column.heading}
                </h2>
                <ul className="mt-4 flex flex-col gap-3 text-sm">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      <Link href={link.href} className="text-deep/85 hover:text-accent">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="border-line/70 text-muted mt-7 flex flex-wrap items-center justify-between gap-3 border-t pt-5 text-sm">
            <p>© {new Date().getFullYear()} EverCalm</p>
            <p>
              Every person knows what is happening, what is expected, what they have completed, and
              what comes next.
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}

/** The compact mark used in the footer: gradient chip plus wordmark. */
function FooterLockup() {
  return (
    <span className="flex items-center gap-3">
      <span
        aria-hidden="true"
        className="flex h-9 w-9 items-center justify-center rounded-[0.7rem] bg-[linear-gradient(135deg,#8b3ff0_0%,#e64bb0_55%,#3fd0e0_100%)]"
      >
        <svg viewBox="0 0 24 12" className="h-3 w-6" fill="none" aria-hidden="true">
          <path
            d="M2 8.5c2.6 0 2.6-5 5.2-5s2.6 5 5.2 5 2.6-5 5.2-5 2.6 5 4.4 5"
            stroke="white"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <span className="font-display text-deep text-xl font-extrabold tracking-tight">EverCalm</span>
    </span>
  )
}
