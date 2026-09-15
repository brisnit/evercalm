import Link from 'next/link'
import { requireActorContext } from '@/server/auth/session'
import { Logo } from '@/ui/primitives'
import { AccountMenu } from './account-menu'

/**
 * The employee header: the mark, an optional way back or across, and the
 * account control with Sign out. Every /my page uses it, so a person can always
 * see who is signed in and leave.
 */
export async function EmployeeHeader({
  back,
  extra,
}: {
  back?: { href: string; label: string } | null
  /** Rendered before the account control, for example "Administration". */
  extra?: React.ReactNode
}) {
  const { actor, activeOrganization } = await requireActorContext()
  return (
    <header className="border-line border-b bg-white px-5 py-2">
      <div className="mx-auto flex w-full max-w-xl items-center justify-between gap-3">
        <Link href="/my" aria-label="Your work" className="shrink-0">
          <Logo size="h-8" eager />
        </Link>
        <div className="flex min-w-0 items-center gap-3">
          {extra}
          {back ? (
            <Link
              href={back.href}
              className="text-muted truncate text-sm underline-offset-4 hover:underline"
            >
              {back.label}
            </Link>
          ) : null}
          <AccountMenu
            name={actor.displayName}
            organizationName={activeOrganization.organizationName}
          />
        </div>
      </div>
    </header>
  )
}

/**
 * The employee page frame: a narrow, phone-first column under the employee
 * header.
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
      <EmployeeHeader back={back} />
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
