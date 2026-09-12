import type { Metadata } from 'next'
import Link from 'next/link'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { listLocations } from '@/modules/org/service'
import { canAtAnyLocation } from '@/server/authz/can'
import { Card, CardHeader, PageHeader } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { InviteForm } from './invite-form'

export const metadata: Metadata = { title: 'Invite someone' }
export const dynamic = 'force-dynamic'

export default async function InvitePage() {
  const { actor } = await requireActorContext()
  if (!canAtAnyLocation(actor, 'people.invite')) {
    return <PermissionDenied capabilityLabel="Invite people" />
  }

  const locations = await withTenant(actor.organizationId, (tx) => listLocations(tx, actor))

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3">
        <Link
          href="/app/people"
          className="text-muted hover:text-ink text-sm underline-offset-4 hover:underline"
        >
          ← People
        </Link>
      </nav>

      <PageHeader
        eyebrow="People"
        title="Invite someone to the team"
        description="They receive a single-use link. Nothing is granted until they accept."
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-start">
        <Card>
          <CardHeader title="Who are you inviting?" />
          <div className="p-5">
            <InviteForm locations={locations} />
          </div>
        </Card>

        <Card>
          <CardHeader title="How invitations work" />
          <div className="p-5">
            <ul className="text-muted flex flex-col gap-3 text-sm">
              <li>
                <span className="text-ink font-medium">Single use.</span> The link works once.
                Opening it again after acceptance does nothing.
              </li>
              <li>
                <span className="text-ink font-medium">Expires in 14 days.</span> You can resend,
                which issues a fresh link and immediately breaks the old one.
              </li>
              <li>
                <span className="text-ink font-medium">Nothing granted early.</span> The role and
                location you choose are stored as intent and only applied when they accept.
              </li>
              <li>
                <span className="text-ink font-medium">Revocable.</span> Revoking kills any
                outstanding link straight away.
              </li>
            </ul>
            <p className="rounded-control border-warning/30 bg-warning-soft text-ink mt-4 border px-3 py-2.5 text-sm">
              Email is in development-safe mode until a sending domain is approved, so nothing is
              actually sent. The acceptance link appears here after you create the invitation.
            </p>
          </div>
        </Card>
      </div>
    </>
  )
}
