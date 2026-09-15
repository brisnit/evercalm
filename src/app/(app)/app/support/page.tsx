import type { Metadata } from 'next'
import Link from 'next/link'
import { formatDateInZone } from '@/lib/dates'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { can } from '@/server/authz/can'
import { CATEGORY_LABELS, STATUS_LABELS, listCases } from '@/modules/support/service'
import { organizationTimeZone } from '@/modules/training/records'
import { Badge, Card, EmptyState, PageHeader } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { LINK_BUTTON_CLASS } from '../training/_components/styles'

export const metadata: Metadata = { title: 'Support' }
export const dynamic = 'force-dynamic'

/** The organization's support cases with EverCalm. */
export default async function SupportPage() {
  const { actor } = await requireActorContext()
  if (!can(actor, 'support.manage'))
    return <PermissionDenied capabilityLabel="Contact EverCalm support" />
  const { cases, timeZone } = await withTenant(actor.organizationId, async (tx) => ({
    cases: await listCases(tx, actor),
    timeZone: await organizationTimeZone(tx, actor.organizationId),
  }))
  return (
    <>
      <PageHeader
        title="Support"
        description="Cases with the EverCalm team. EverCalm support never signs in as anyone in your organization or reads their messages; tell us what you see."
        action={
          <Link href="/app/support/new" className={LINK_BUTTON_CLASS}>
            Open a case
          </Link>
        }
      />
      {cases.length === 0 ? (
        <EmptyState
          title="No support cases"
          description="If something is not working, or you have a question about your account, open a case and the EverCalm team will reply here."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {cases.map((c) => {
            const status = STATUS_LABELS[c.status]
            return (
              <li key={c.id}>
                <Card className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-faint text-xs font-semibold tracking-wide">
                        {c.reference}
                      </p>
                      <h2 className="text-ink font-semibold">
                        <Link
                          href={`/app/support/${c.id}`}
                          className="underline-offset-4 hover:underline"
                        >
                          {c.subject}
                        </Link>
                      </h2>
                      <p className="text-muted text-sm">
                        {CATEGORY_LABELS[c.category]} · opened by {c.createdByLabel} · updated{' '}
                        {formatDateInZone(c.updatedAt, timeZone)}
                      </p>
                    </div>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </div>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
