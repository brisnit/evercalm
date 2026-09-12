import Link from 'next/link'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { listLocations } from '@/modules/org/service'
import { canAtAnyLocation } from '@/server/authz/can'
import { Badge, Card, CardHeader, EmptyState, PageHeader } from '@/ui/primitives'

export const dynamic = 'force-dynamic'

/**
 * Administration overview.
 *
 * Slice 1 shows what is genuinely known: who you are, what you can do, and
 * where you work. It deliberately shows no counts of shifts, training, or
 * checklists - those systems do not exist yet, and a dashboard of zeroes
 * would be a vanity metric pretending to be information.
 */
export default async function AppOverviewPage() {
  const { actor, activeOrganization } = await requireActorContext()

  const locations = await withTenant(actor.organizationId, (tx) => listLocations(tx, actor))

  const roleSummary = actor.grants.map((g) => ({
    id: `${g.roleId}-${g.locationId ?? 'org'}`,
    name: g.roleName,
    scope: g.scope,
    locationName:
      g.locationId === null
        ? null
        : (locations.find((l) => l.id === g.locationId)?.name ?? 'Unknown location'),
    capabilityCount: g.capabilities.size,
  }))

  return (
    <>
      <PageHeader
        eyebrow={activeOrganization.industry.replace(/_/g, ' ')}
        title={`Good to see you, ${actor.displayName.split(' ')[0] ?? actor.displayName}`}
        description="This is the foundation release. Scheduling, training, and daily operations arrive in later slices."
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Your access"
            description="What you can do, and where. Granted by an owner."
          />
          <div className="p-5">
            {roleSummary.length === 0 ? (
              <EmptyState
                title="No roles granted yet"
                description="An owner or HR administrator needs to grant you a role before you can act."
              />
            ) : (
              <ul className="flex flex-col gap-3">
                {roleSummary.map((r) => (
                  <li
                    key={r.id}
                    className="rounded-control border-line flex flex-wrap items-center justify-between gap-2 border px-3.5 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-ink text-sm font-medium">{r.name}</p>
                      <p className="text-muted text-xs">
                        {r.scope === 'org'
                          ? 'Across the whole organization'
                          : `At ${r.locationName}`}
                      </p>
                    </div>
                    <Badge tone={r.scope === 'org' ? 'violet' : 'neutral'}>
                      {r.capabilityCount} {r.capabilityCount === 1 ? 'permission' : 'permissions'}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Locations"
            description={
              canAtAnyLocation(actor, 'org.manage_locations')
                ? 'Manage these in Settings.'
                : 'Sites in this organization.'
            }
          />
          <div className="p-5">
            {locations.length === 0 ? (
              <EmptyState
                title="No locations yet"
                description="Add your first location so shifts and schedules have somewhere to live."
                action={
                  canAtAnyLocation(actor, 'org.manage_locations') ? (
                    <Link
                      href="/app/settings"
                      className="text-sm font-medium text-violet-700 underline underline-offset-4"
                    >
                      Go to Settings
                    </Link>
                  ) : undefined
                }
              />
            ) : (
              <ul className="flex flex-col gap-2.5" data-testid="location-list">
                {locations.map((l) => (
                  <li
                    key={l.id}
                    className="rounded-control border-line flex flex-wrap items-center justify-between gap-2 border px-3.5 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-ink text-sm font-medium">{l.name}</p>
                      <p className="text-muted text-xs">
                        {[l.city, l.region].filter(Boolean).join(', ') || l.timezone}
                      </p>
                    </div>
                    <Badge tone="neutral">{l.timezone.split('/')[1]?.replace(/_/g, ' ')}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>
    </>
  )
}
