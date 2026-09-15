import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireActorContext } from '@/server/auth/session'
import { Badge, Logo } from '@/ui/primitives'
import { AppNav } from '@/ui/patterns/app-nav'
import { NavigationProgress } from '@/ui/patterns/navigation-progress'
import { isEmployeeOnly, visibleNavItems } from './navigation'
import { SignOutButton } from './sign-out-button'
import { withTenant } from '@/server/db'
import { billingBanner } from '@/modules/billing/service'

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
  const banner = await withTenant(actor.organizationId, (tx) => billingBanner(tx, actor))

  return (
    <div className="bg-canvas flex min-h-screen flex-col">
      <NavigationProgress />
      <header className="border-line border-b bg-white">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-x-4 px-5 py-2.5">
          <Link href="/app" aria-label="EverCalm overview" className="shrink-0">
            <Logo size="h-7 sm:h-8" eager />
          </Link>

          <div className="border-line flex min-w-0 flex-1 items-center gap-2 sm:border-l sm:pl-4">
            <span className="text-ink truncate text-sm font-semibold">
              {activeOrganization.organizationName}
            </span>
            {memberships.length > 1 ? (
              <Badge tone="neutral">{memberships.length} workspaces</Badge>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <span className="text-muted mr-1 hidden text-sm md:inline">{actor.displayName}</span>
            <Link
              href="/my"
              className="rounded-control text-muted hover:text-ink inline-flex min-h-11 items-center px-2.5 text-sm font-medium hover:bg-violet-50"
            >
              My work
            </Link>
            <SignOutButton />
          </div>
        </div>

        <AppNav
          label="Administration"
          items={nav.map((item) => ({ href: item.href, label: item.label }))}
          exact={['/app']}
        />
      </header>

      {banner ? (
        <div
          role="status"
          className={
            banner.tone === 'danger'
              ? 'border-danger/30 bg-danger-soft border-b'
              : banner.tone === 'warning'
                ? 'border-warning/30 bg-warning-soft border-b'
                : 'border-info/25 bg-info-soft border-b'
          }
        >
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-2.5 text-sm">
            <p className="text-ink min-w-0">
              <span className="font-semibold">{banner.title}.</span> {banner.body}
            </p>
            {banner.href ? (
              <Link
                href={banner.href}
                className="text-ink shrink-0 font-medium underline underline-offset-4"
              >
                Billing
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-5 py-8">
        {children}
      </main>
    </div>
  )
}
