import type { Metadata } from 'next'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { listDepartments, listJobRoles, listStations } from '@/modules/structure/service'
import { listLocations } from '@/modules/org/service'
import { can } from '@/server/authz/can'
import { Badge, Card, CardHeader, EmptyState, PageHeader } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { StructureForms } from './forms'

export const metadata: Metadata = { title: 'Structure' }
export const dynamic = 'force-dynamic'

/**
 * Organizational structure.
 *
 * Nothing here assumes an industry. The copy says "work positions" rather than
 * "stations" or "chairs", and each tenant fills the concept with its own
 * vocabulary - which is exactly what the two demo organizations demonstrate.
 */
export default async function StructurePage() {
  const { actor } = await requireActorContext()
  if (!can(actor, 'org.view'))
    return <PermissionDenied capabilityLabel="View organization settings" />

  const data = await withTenant(actor.organizationId, async (tx) => ({
    departments: await listDepartments(tx, actor),
    jobRoles: await listJobRoles(tx, actor),
    stations: await listStations(tx, actor),
    locations: await listLocations(tx, actor),
  }))

  const mayManage = can(actor, 'org.manage_structure')
  const stationsByLocation = data.locations.map((location) => ({
    location,
    stations: data.stations.filter((s) => s.locationId === location.id),
  }))

  return (
    <>
      <PageHeader
        title="Structure"
        description="Departments, the roles people work, and the positions they work them at."
      />

      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        <Card>
          <CardHeader
            title="Job roles"
            description="What someone does. Drives training and, later, scheduling."
          />
          <div className="p-5">
            {data.jobRoles.length === 0 ? (
              <EmptyState
                title="No job roles yet"
                description="Add the roles people actually work, in your own words."
              />
            ) : (
              <ul className="flex flex-col gap-2.5">
                {data.jobRoles.map((role) => (
                  <li
                    key={role.id}
                    className="rounded-control border-line flex flex-wrap items-center justify-between gap-2 border px-3.5 py-3"
                  >
                    <span className="min-w-0">
                      <span className="text-ink block text-sm font-medium">{role.name}</span>
                      <span className="text-muted block text-xs">
                        {role.departmentName ?? 'No department'}
                        {role.description ? ` · ${role.description}` : ''}
                      </span>
                    </span>
                    <Badge tone="neutral">
                      {role.peopleCount} {role.peopleCount === 1 ? 'person' : 'people'}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Departments" description="How the organization groups its work." />
          <div className="p-5">
            {data.departments.length === 0 ? (
              <EmptyState
                title="No departments yet"
                description="Group roles however your business does."
              />
            ) : (
              <ul className="flex flex-col gap-2.5">
                {data.departments.map((department) => (
                  <li
                    key={department.id}
                    className="rounded-control border-line border px-3.5 py-3"
                  >
                    <span className="text-ink block text-sm font-medium">{department.name}</span>
                    {department.description ? (
                      <span className="text-muted block text-xs">{department.description}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Work positions"
            description="Where work happens at each location. Call them what your business calls them."
          />
          <div className="p-5">
            {data.stations.length === 0 ? (
              <EmptyState
                title="No work positions yet"
                description="A bar and a host stand, or chairs and treatment rooms — whatever fits your business."
              />
            ) : (
              <div className="grid gap-5 md:grid-cols-2">
                {stationsByLocation.map(({ location, stations }) => (
                  <div key={location.id}>
                    <h3 className="font-display text-ink mb-2 text-sm font-bold">
                      {location.name}
                    </h3>
                    {stations.length === 0 ? (
                      <p className="text-muted text-sm">Nothing set up here yet.</p>
                    ) : (
                      <ul className="flex flex-wrap gap-2">
                        {stations.map((station) => (
                          <li key={station.id}>
                            <span className="rounded-control border-line inline-flex flex-col border px-3 py-2">
                              <span className="text-ink text-sm font-medium">{station.name}</span>
                              <span className="text-muted text-xs">
                                {station.jobRoleName ?? 'Any role'}
                              </span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>

      {mayManage ? (
        <div className="mt-5">
          <StructureForms
            departments={data.departments}
            locations={data.locations}
            jobRoles={data.jobRoles}
          />
        </div>
      ) : null}
    </>
  )
}
