import type { Metadata } from 'next'
import Link from 'next/link'
import { PLATFORM_ROLE_LABELS, requirePlatformStaff } from '@/server/auth/platform-staff'
import { Logo } from '@/ui/primitives'
import { SignOutButton } from '../../(app)/app/sign-out-button'

export const metadata: Metadata = {
  title: { default: 'EverCalm team', template: '%s · EverCalm team' },
  robots: { index: false },
}
export const dynamic = 'force-dynamic'

/**
 * The EverCalm team dashboard. For EverCalm staff only: anyone else is shown
 * a 404, and no page here reads a customer's employees, messages or HR records.
 */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const staff = await requirePlatformStaff('directory')
  return (
    <div className="bg-raise flex min-h-screen flex-col">
      <header className="border-line border-b bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3">
          <Link href="/platform" aria-label="EverCalm team home" className="shrink-0">
            <Logo size="h-8" eager />
          </Link>
          <span className="rounded-full bg-violet-600 px-2.5 py-0.5 text-xs font-semibold text-white">
            EverCalm team
          </span>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-muted hidden text-sm sm:inline">
              {staff.displayName} · {PLATFORM_ROLE_LABELS[staff.role]}
            </span>
            <SignOutButton />
          </div>
        </div>
        <nav aria-label="EverCalm team" className="border-line border-t">
          <ul className="mx-auto flex w-full max-w-6xl flex-wrap gap-x-1 px-3">
            {[
              ['/platform', 'Organizations'],
              ['/platform/support', 'Support cases'],
            ].map(([href, label]) => (
              <li key={href}>
                <Link
                  href={href!}
                  className="rounded-control text-muted hover:bg-sunk hover:text-ink inline-flex min-h-11 items-center px-3 text-sm"
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-5 py-8">
        {children}
      </main>
    </div>
  )
}
