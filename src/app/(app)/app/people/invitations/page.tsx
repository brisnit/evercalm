import type { Metadata } from 'next'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { listInvitations } from '@/modules/invitations/service'
import { canAtAnyLocation } from '@/server/authz/can'
import { ForbiddenError } from '@/lib/errors'
import {
  BackLink,
  Badge,
  ButtonLink,
  Card,
  EmptyState,
  PageHeader,
  ScrollArea,
  TextLink,
} from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { InvitationRowActions } from './row-actions'

export const metadata: Metadata = { title: 'Invitations' }
export const dynamic = 'force-dynamic'

const STATUS: Record<
  string,
  { tone: 'accent' | 'success' | 'neutral' | 'warning'; label: string }
> = {
  pending: { tone: 'accent', label: 'Waiting' },
  accepted: { tone: 'success', label: 'Accepted' },
  revoked: { tone: 'neutral', label: 'Revoked' },
  expired: { tone: 'warning', label: 'Expired' },
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(value)
}

export default async function InvitationsPage() {
  const { actor } = await requireActorContext()
  if (!canAtAnyLocation(actor, 'people.invite')) {
    return <PermissionDenied capabilityLabel="Invite people" />
  }

  const invitations = await withTenant(actor.organizationId, async (tx) => {
    try {
      return await listInvitations(tx, actor)
    } catch (error) {
      if (error instanceof ForbiddenError) return null
      throw error
    }
  })

  if (!invitations) return <PermissionDenied capabilityLabel="Invite people" />

  const counts = {
    pending: invitations.filter((i) => i.status === 'pending').length,
    accepted: invitations.filter((i) => i.status === 'accepted').length,
    expired: invitations.filter((i) => i.status === 'expired').length,
    revoked: invitations.filter((i) => i.status === 'revoked').length,
  }

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3">
        <BackLink href="/app/people">People</BackLink>
      </nav>

      <PageHeader
        title="Invitations"
        description="Every invitation sent, and where it got to."
        action={<ButtonLink href="/app/people/invite">Invite someone</ButtonLink>}
      />

      <div className="mb-5 flex flex-wrap gap-2">
        <Badge tone="accent">{counts.pending} waiting</Badge>
        <Badge tone="success">{counts.accepted} accepted</Badge>
        <Badge tone="warning">{counts.expired} expired</Badge>
        <Badge tone="neutral">{counts.revoked} revoked</Badge>
      </div>

      {invitations.length === 0 ? (
        <EmptyState
          title="No invitations yet"
          description="When you invite someone, their invitation and its status appear here."
          action={
            <TextLink href="/app/people/invite" className="text-sm">
              Invite your first team member
            </TextLink>
          }
        />
      ) : (
        <Card>
          <ScrollArea label="Invitations, scrollable horizontally">
            <table className="w-full min-w-[46rem] text-sm">
              <caption className="sr-only">Invitations and their status</caption>
              <thead>
                <tr className="border-line-strong bg-sunk border-b text-left">
                  {['Person', 'Role', 'Status', 'Expires', 'Sent', ''].map((heading, i) => (
                    <th
                      key={heading || `actions-${i}`}
                      scope="col"
                      className="text-muted px-5 py-3 text-xs font-semibold tracking-wide uppercase"
                    >
                      {heading || <span className="sr-only">Actions</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invitations.map((invitation) => {
                  const status = STATUS[invitation.status] ?? STATUS.pending!
                  return (
                    <tr key={invitation.id} className="border-line border-b last:border-b-0">
                      <td className="px-5 py-3">
                        <span className="text-ink block font-medium">{invitation.displayName}</span>
                        <span className="text-muted block text-xs">
                          {invitation.jobTitle ?? '—'}
                        </span>
                      </td>
                      <td className="text-muted px-5 py-3">
                        {invitation.roleName}
                        <span className="text-faint block text-xs">
                          {invitation.scope === 'org'
                            ? 'Organization-wide'
                            : (invitation.scopeLocationName ?? 'A location')}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </td>
                      <td className="text-muted px-5 py-3 whitespace-nowrap tabular-nums">
                        {formatDate(invitation.expiresAt)}
                      </td>
                      <td className="text-muted px-5 py-3 whitespace-nowrap tabular-nums">
                        {formatDate(invitation.lastSentAt)}
                        {invitation.sendCount > 1 ? (
                          <span className="text-faint block text-xs">
                            sent {invitation.sendCount} times
                          </span>
                        ) : null}
                      </td>
                      <td className="px-5 py-3">
                        {invitation.status === 'pending' || invitation.status === 'expired' ? (
                          <InvitationRowActions invitationId={invitation.id} canResend />
                        ) : (
                          <span className="text-faint text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </ScrollArea>
        </Card>
      )}
    </>
  )
}
