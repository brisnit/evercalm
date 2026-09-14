import Link from 'next/link'
import { Logo } from '@/ui/primitives'

/**
 * The employee page frame: a narrow, phone-first column with the mark on the
 * left and one way back on the right.
 *
 * The inbox and notification pages predate this and inline the same markup;
 * new employee pages use this so the frame stays identical everywhere.
 */
export function EmployeeShell({
  children,
  back = { href: '/my', label: 'Back' },
}: {
  children: React.ReactNode
  back?: { href: string; label: string }
}) {
  return (
    <div className="bg-raise flex min-h-screen flex-col">
      <header className="border-line border-b bg-white px-5 py-3">
        <div className="mx-auto flex w-full max-w-xl items-center justify-between gap-3">
          <Link href="/my" aria-label="Your work">
            <Logo size="h-8" eager />
          </Link>
          <Link href={back.href} className="text-muted text-sm underline-offset-4 hover:underline">
            {back.label}
          </Link>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-xl flex-1 px-5 py-7">
        {children}
      </main>
    </div>
  )
}

/** A small sub-navigation between the employee scheduling pages. */
export function ScheduleTabs({ current }: { current: 'schedule' | 'time-off' | 'availability' }) {
  const tabs = [
    { key: 'schedule', href: '/my/schedule', label: 'Shifts' },
    { key: 'time-off', href: '/my/time-off', label: 'Time off' },
    { key: 'availability', href: '/my/availability', label: 'Availability' },
  ] as const
  return (
    <nav aria-label="Schedule" className="border-line mt-5 border-b">
      <ul className="-mb-px flex gap-1">
        {tabs.map((tab) => (
          <li key={tab.key}>
            <Link
              href={tab.href}
              aria-current={current === tab.key ? 'page' : undefined}
              className={
                current === tab.key
                  ? 'text-ink inline-flex min-h-11 items-center border-b-2 border-violet-600 px-3 text-sm font-semibold'
                  : 'text-muted hover:text-ink inline-flex min-h-11 items-center border-b-2 border-transparent px-3 text-sm'
              }
            >
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
