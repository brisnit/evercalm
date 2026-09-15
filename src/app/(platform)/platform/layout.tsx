import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { AppNav } from '@/ui/patterns/app-nav'
import { NavigationProgress } from '@/ui/patterns/navigation-progress'
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
    <div className="bg-canvas flex min-h-screen flex-col">
      <Suspense fallback={null}>
        <NavigationProgress />
      </Suspense>
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
        <AppNav
          label="EverCalm team"
          items={[
            { href: '/platform', label: 'Organizations' },
            { href: '/platform/support', label: 'Support cases' },
          ]}
          exact={['/platform']}
        />
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-5 py-8">
        {children}
      </main>
    </div>
  )
}
