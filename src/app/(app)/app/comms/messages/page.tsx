import type { Metadata } from 'next'
import Link from 'next/link'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { canAtAnyLocation } from '@/server/authz/can'
import { listThreads, messageablePeople } from '@/modules/messaging/service'
import { Avatar, Badge, Card, CardHeader, EmptyState, PageHeader } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { StartThread } from '@/ui/patterns/start-thread'

export const metadata: Metadata = { title: 'Messages' }
export const dynamic = 'force-dynamic'

/**
 * Direct messages, from the manager's side.
 *
 * One conversation per person, never a group: a message about somebody's hours
 * or a hard week is between the two of them, and a thread that can grow a
 * third participant is a different, riskier product.
 */
export default async function MessagesPage() {
  const { actor } = await requireActorContext()
  if (!canAtAnyLocation(actor, 'announcement.create')) {
    return <PermissionDenied capabilityLabel="Use communication" />
  }

  const { threads, people } = await withTenant(actor.organizationId, async (tx) => ({
    threads: await listThreads(tx, actor),
    people: await messageablePeople(tx, actor),
  }))

  return (
    <>
      <PageHeader
        title="Messages"
        description="One conversation per person. Nothing here is broadcast."
      />

      <div className="mt-7 grid gap-5 lg:grid-cols-[1.6fr_1fr] lg:items-start">
        <div className="flex flex-col gap-3">
          {threads.length === 0 ? (
            <EmptyState
              title="No conversations yet"
              description="Pick somebody on the right to start one."
            />
          ) : (
            threads.map((thread) => (
              <Link
                key={thread.id}
                href={`/app/comms/messages/${thread.id}`}
                className="rounded-card border-line shadow-low hover:shadow-lift flex items-center gap-3 border bg-white p-4 transition-shadow"
              >
                <Avatar name={thread.otherName} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-ink font-semibold">{thread.otherName}</span>
                    {thread.otherJobTitle ? (
                      <span className="text-faint text-xs">{thread.otherJobTitle}</span>
                    ) : null}
                    {thread.unread > 0 ? (
                      <Badge tone="warning">{thread.unread} unread</Badge>
                    ) : null}
                  </span>
                  <span className="text-muted mt-0.5 block truncate text-sm">
                    {thread.lastBody ?? 'No messages yet.'}
                  </span>
                </span>
              </Link>
            ))
          )}
        </div>

        <Card>
          <CardHeader
            title="Start a conversation"
            description="Everyone you can message. Their reply comes back here."
          />
          <div className="p-5">
            <StartThread people={people} from="app" />
          </div>
        </Card>
      </div>
    </>
  )
}
