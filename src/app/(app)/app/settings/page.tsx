import type { Metadata } from 'next'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { getOrganization, listLocations } from '@/modules/org/service'
import { can } from '@/server/authz/can'
import { ForbiddenError } from '@/lib/errors'
import { Badge, Card, CardHeader, EmptyState, PageHeader } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { AddLocationForm } from './add-location-form'

export const metadata: Metadata = { title: 'Settings' }
export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const { actor } = await requireActorContext()

  // Server-side gate. Hiding the nav entry is not the control: navigating
  // straight to this URL without the capability is refused here.
  if (!can(actor, 'org.view')) {
    return <PermissionDenied capabilityLabel="View organization settings" />
  }

  const data = await withTenant(actor.organizationId, async (tx) => {
    try {
      const organization = await getOrganization(tx, actor)
      const locations = await listLocations(tx, actor)
      return { organization, locations }
    } catch (error) {
      if (error instanceof ForbiddenError) return null
      throw error
    }
  })

  if (!data) return <PermissionDenied capabilityLabel="View organization settings" />

  const mayManage = can(actor, 'org.manage_locations')

  return (
    <>
      <PageHeader
        eyebrow="Organization"
        title={data.organization.name}
        description="Foundation settings. People, scheduling, and training settings arrive with their slices."
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_1.15fr] lg:items-start">
        <Card>
          <CardHeader title="Profile" />
          <dl className="divide-line flex flex-col divide-y">
            {[
              ['Industry', data.organization.industry.replace(/_/g, ' ')],
              ['Workspace', data.organization.slug],
              ['Default timezone', data.organization.timezone],
              ['Jurisdiction', data.organization.jurisdiction ?? 'Not set'],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-4 px-5 py-3">
                <dt className="text-muted text-sm">{label}</dt>
                <dd className="text-ink text-sm font-medium capitalize">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="border-line text-faint border-t px-5 py-3 text-xs">
            Jurisdiction is recorded for future policy content that qualified people review. It
            carries no legal logic.
          </p>
        </Card>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader
              title="Locations"
              description="Each location keeps its own timezone, because a business date is local to the site."
            />
            <div className="p-5">
              {data.locations.length === 0 ? (
                <EmptyState
                  title="No locations yet"
                  description="Add the first site so schedules and checklists have somewhere to live."
                />
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {data.locations.map((l) => (
                    <li
                      key={l.id}
                      className="rounded-control border-line flex flex-wrap items-center justify-between gap-2 border px-3.5 py-3"
                    >
                      <div className="min-w-0">
                        <p className="text-ink text-sm font-medium">{l.name}</p>
                        <p className="text-muted text-xs">
                          {[l.city, l.region].filter(Boolean).join(', ') || 'No address on file'}
                        </p>
                      </div>
                      <Badge tone="neutral">{l.timezone}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          {mayManage ? (
            <Card>
              <CardHeader title="Add a location" />
              <div className="p-5">
                <AddLocationForm />
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  )
}
