import type { Metadata } from 'next'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { listAuditEvents } from '@/modules/audit/service'
import { can } from '@/server/authz/can'
import { Badge, Card, EmptyState, PageHeader, ScrollArea, TextLink } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'

export const metadata: Metadata = { title: 'Audit log' }
export const dynamic = 'force-dynamic'

const TONE_BY_PREFIX: Record<string, 'violet' | 'warning' | 'neutral'> = {
  role_grant: 'warning',
  role: 'warning',
  organization: 'violet',
  location: 'violet',
  employment: 'violet',
  access: 'warning',
}

function formatTimestamp(value: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value)
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>
}) {
  const showAll = (await searchParams).all === '1'
  const { actor } = await requireActorContext()

  if (!can(actor, 'org.view_audit')) {
    return <PermissionDenied capabilityLabel="View audit history" />
  }

  const events = await withTenant(actor.organizationId, (tx) =>
    listAuditEvents(tx, actor, showAll ? 200 : 25),
  )

  return (
    <>
      <PageHeader
        title="Audit log"
        description="An append-only record of sensitive actions. Entries cannot be edited or deleted, including by EverCalm."
      />

      {events.length === 0 ? (
        <EmptyState
          title="No audit events yet"
          description="Actions such as creating a location or granting a role will appear here as they happen."
        />
      ) : (
        <Card>
          <ScrollArea label="Audit events, scrollable horizontally">
            <table className="w-full min-w-[44rem] text-sm">
              <caption className="sr-only">
                Audit events for this organization, newest first
              </caption>
              <thead>
                <tr className="border-line-strong bg-sunk border-b text-left">
                  <th
                    scope="col"
                    className="text-muted px-5 py-3 text-xs font-semibold tracking-wide uppercase"
                  >
                    When
                  </th>
                  <th
                    scope="col"
                    className="text-muted px-5 py-3 text-xs font-semibold tracking-wide uppercase"
                  >
                    Action
                  </th>
                  <th
                    scope="col"
                    className="text-muted px-5 py-3 text-xs font-semibold tracking-wide uppercase"
                  >
                    What happened
                  </th>
                  <th
                    scope="col"
                    className="text-muted px-5 py-3 text-xs font-semibold tracking-wide uppercase"
                  >
                    Who
                  </th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id} className="border-line border-b last:border-b-0">
                    <td className="text-muted px-5 py-3 whitespace-nowrap">
                      {formatTimestamp(event.createdAt)}
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={TONE_BY_PREFIX[event.action.split('.')[0] ?? ''] ?? 'neutral'}>
                        {event.action}
                      </Badge>
                    </td>
                    <td className="text-ink px-5 py-3">{event.summary}</td>
                    <td className="text-muted px-5 py-3 whitespace-nowrap">
                      {event.actorLabel ?? 'Unknown'}
                      {event.actorType !== 'user' ? ` (${event.actorType})` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
          <div className="border-line flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3 text-sm">
            <span className="text-muted">
              {`The latest ${events.length} ${events.length === 1 ? 'entry' : 'entries'}.`}
            </span>
            {!showAll && events.length === 25 ? (
              <TextLink href="/app/settings/audit?all=1" standalone>
                Show older entries
              </TextLink>
            ) : null}
          </div>
        </Card>
      )}
    </>
  )
}
