import type { Metadata } from 'next'
import Link from 'next/link'
import { resolveInvitationToken } from '@/server/auth/invitation-access'
import { Card } from '@/ui/primitives'
import { AcceptForm } from './accept-form'

export const metadata: Metadata = { title: 'Accept your invitation' }
export const dynamic = 'force-dynamic'

/**
 * Invitation acceptance.
 *
 * Shows the organization name and asks for a password. It deliberately does
 * NOT show the email address the invitation was sent to: the page must not be
 * usable to discover who an address belongs to, and the account is created
 * from the invitation's own address rather than anything typed here.
 *
 * An invalid, used, revoked, or expired link all produce the same screen.
 */
export default async function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const invitation = await resolveInvitationToken(token)

  if (!invitation) {
    return (
      <Card className="p-6">
        <h1 className="font-display text-ink text-xl font-extrabold">
          This link is no longer valid
        </h1>
        <p className="text-muted mt-3 text-sm">
          Invitations expire after two weeks, and each one can be used only once. Ask whoever
          invited you to send a new link.
        </p>
        <p className="mt-5">
          <Link
            href="/signin"
            className="text-sm font-medium text-violet-700 underline underline-offset-4"
          >
            Sign in instead
          </Link>
        </p>
      </Card>
    )
  }

  return (
    <>
      <p className="text-xs font-semibold tracking-[0.1em] text-violet-700 uppercase">
        You have been invited
      </p>
      <h1 className="font-display text-ink mt-2 text-2xl font-extrabold tracking-tight text-balance">
        Join {invitation.organizationName}
      </h1>
      <p className="text-muted mt-2 text-sm">
        Choose a password and your account is ready. This link works once.
      </p>

      <div className="mt-6">
        <Card className="p-6">
          <AcceptForm token={token} organizationName={invitation.organizationName} />
        </Card>
      </div>
    </>
  )
}
