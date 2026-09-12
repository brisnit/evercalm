import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireActorContext } from '@/server/auth/session'
import { Badge, Logo } from '@/ui/primitives'
import { isEmployeeOnly, visibleNavItems } from './navigation'
import { SignOutButton } from './sign-out-button'

/**
 * Company administration shell.
 *
 * An employee with no administrative capability is redirected to /my
 * server-side. This is a convenience for them, not a security control - the
 * pages below authorize independently.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { actor, activeOrganization, memberships } = await requireActorContext()

  if (isEmployeeOnly(actor)) redirect('/my')

  const nav = visibleNavItems(actor)

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-line border-b bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-5 gap-y-3 px-5 py-3">
          <Link href="/app" aria-label="EverCalm overview" className="shrink-0">
            <Logo height={24} priority />
          </Link>

          <div className="flex min-w-0 items-center gap-2">
            <span className="text-ink truncate text-sm font-medium">
              {activeOrganization.organizationName}
            </span>
            {memberships.length > 1 ? (
              <Badge tone="neutral">{memberships.length} workspaces</Badge>
            ) : null}
          </div>

          <div className="ml-auto flex items-center gap-3">
            <span className="text-muted hidden text-sm sm:inline">{actor.displayName}</span>
            <Link href="/my" className="text-muted text-sm underline-offset-4 hover:underline">
              My work
            </Link>
            <SignOutButton />
          </div>
        </div>

        <nav aria-label="Administration" className="border-line border-t">
          <ul className="mx-auto flex w-full max-w-6xl flex-wrap gap-x-1 px-3">
            {nav.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="rounded-control text-muted hover:bg-sunk hover:text-ink inline-flex min-h-11 items-center px-3 text-sm"
                >
                  {item.label}
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
