import type { Metadata } from 'next'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { listLocations } from '@/modules/org/service'
import { listJobRoles } from '@/modules/structure/service'
import { canAtAnyLocation } from '@/server/authz/can'
import { Card, CardHeader, PageHeader } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { ImportWizard } from './wizard'

export const metadata: Metadata = { title: 'Import people' }
export const dynamic = 'force-dynamic'

export default async function ImportPage() {
  const { actor } = await requireActorContext()
  if (!canAtAnyLocation(actor, 'people.invite')) {
    return <PermissionDenied capabilityLabel="Invite people" />
  }

  const reference = await withTenant(actor.organizationId, async (tx) => ({
    locations: await listLocations(tx, actor),
    jobRoles: await listJobRoles(tx, actor),
  }))

  return (
    <>
      <PageHeader
        back={{ href: '/app/people', label: 'People' }}
        title="Import from a spreadsheet"
        description="Add a lot of people at once. Nothing is created until you have seen exactly what will happen."
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start">
        <ImportWizard />

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="What the file needs" />
            <div className="p-5">
              <p className="text-muted text-sm">
                Two columns are required: <span className="text-ink font-medium">Full name</span>{' '}
                and <span className="text-ink font-medium">Email</span>. Everything else is
                optional, and you can map your own column names in the next step.
              </p>
              <ul className="text-muted mt-3 flex list-disc flex-col gap-1 pl-5 text-sm">
                <li>Job title, phone, and hire date are free text</li>
                <li>Location and job role must match ones you have already set up</li>
                <li>Manager can be a colleague&rsquo;s name or email</li>
              </ul>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Names this file can use"
              description="Spelled exactly as they are here."
            />
            <div className="flex flex-col gap-4 p-5">
              <div>
                <h3 className="text-muted text-xs font-semibold tracking-wide uppercase">
                  Locations
                </h3>
                <p className="text-ink mt-1 text-sm">
                  {reference.locations.map((l) => l.name).join(' · ') || 'None set up yet'}
                </p>
              </div>
              <div>
                <h3 className="text-muted text-xs font-semibold tracking-wide uppercase">
                  Job roles
                </h3>
                <p className="text-ink mt-1 text-sm">
                  {reference.jobRoles.map((r) => r.name).join(' · ') || 'None set up yet'}
                </p>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="What happens on import" />
            <div className="p-5">
              <ul className="text-muted flex flex-col gap-2 text-sm">
                <li>
                  <span className="text-ink font-medium">Everything or nothing.</span> Valid rows
                  are created in a single transaction, so a failure cannot leave a half-imported
                  directory.
                </li>
                <li>
                  <span className="text-ink font-medium">No accounts are created.</span> Imported
                  people appear in the directory as invited and cannot sign in until they accept an
                  invitation.
                </li>
                <li>
                  <span className="text-ink font-medium">Invitations are your choice.</span> Nothing
                  is emailed unless you tick the box at the last step.
                </li>
              </ul>
            </div>
          </Card>
        </div>
      </div>
    </>
  )
}
