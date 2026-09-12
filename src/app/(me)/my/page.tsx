import type { Metadata } from 'next'
import Link from 'next/link'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { listLocations } from '@/modules/org/service'
import { Badge, Card, CardHeader, Logo } from '@/ui/primitives'

export const metadata: Metadata = { title: 'My work' }
export const dynamic = 'force-dynamic'

/**
 * Employee home - mobile-first, and a separate information architecture from
 * /app rather than a narrowed version of it.
 *
 * Slice 1 can honestly answer only "where do I work and what am I". Shifts,
 * training, and today's tasks appear as their slices land. Nothing here is a
 * placeholder card pretending to hold data.
 */
export default async function MyWorkPage() {
  const { actor, activeOrganization } = await requireActorContext()

  const locations = await withTenant(actor.organizationId, (tx) => listLocations(tx, actor))
  const myLocations = locations.filter((l) => actor.locationIds.includes(l.id))
  const hasAdminAccess = actor.grants.some((g) => g.capabilities.size > 0)

  return (
    <div className="bg-raise flex min-h-screen flex-col">
      <header className="border-line border-b bg-white px-5 py-3">
        <div className="mx-auto flex w-full max-w-xl items-center justify-between gap-3">
          <Logo height={22} priority />
          {hasAdminAccess ? (
            <Link href="/app" className="text-muted text-sm underline-offset-4 hover:underline">
              Administration
            </Link>
          ) : null}
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-xl flex-1 px-5 py-7">
        <p className="text-faint text-xs font-semibold tracking-[0.1em] uppercase">
          {activeOrganization.organizationName}
        </p>
        <h1 className="font-display text-ink mt-1 text-2xl font-extrabold tracking-tight">
          Hello, {actor.displayName.split(' ')[0] ?? actor.displayName}
        </h1>

        <div className="mt-6 flex flex-col gap-4">
          <Card>
            <CardHeader title="Where you work" />
            <div className="p-5">
              {myLocations.length === 0 ? (
                <p className="text-muted text-sm">
                  You are not assigned to a location yet. Your manager can assign you one.
                </p>
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {myLocations.map((l) => (
                    <li
                      key={l.id}
                      className="rounded-control border-line flex items-center justify-between gap-3 border bg-white px-3.5 py-3"
                    >
                      <span className="text-ink text-sm font-medium">{l.name}</span>
                      <Badge tone="neutral">{l.timezone.split('/')[1]?.replace(/_/g, ' ')}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          <Card className="border-dashed bg-transparent">
            <div className="p-5">
              <h2 className="font-display text-ink text-sm font-bold">Coming in later slices</h2>
              <p className="text-muted mt-1.5 text-sm">
                Your next shift, announcements to acknowledge, training that is due, and
                today&rsquo;s responsibilities will appear here. They are not built yet, so nothing
                on this screen pretends to show them.
              </p>
            </div>
          </Card>
        </div>
      </main>
    </div>
  )
}
