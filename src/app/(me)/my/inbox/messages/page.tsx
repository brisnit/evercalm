import type { Metadata } from 'next'
import Link from 'next/link'
import { EmployeeHeader, EmployeeTitle } from '../../_components/employee-shell'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { listChannels, listThreads, messageablePeople } from '@/modules/messaging/service'
import { Avatar, Badge, Card, CardHeader, EmptyState } from '@/ui/primitives'
import { InboxTabs } from '@/ui/patterns/inbox-tabs'
import { StartThread } from '@/ui/patterns/start-thread'

export const metadata: Metadata = { title: 'Messages' }
export const dynamic = 'force-dynamic'

export default async function StaffMessagesPage() {
  const { actor } = await requireActorContext()
  const { threads, people, channels } = await withTenant(actor.organizationId, async (tx) => ({
    threads: await listThreads(tx, actor),
    people: await messageablePeople(tx, actor),
    channels: await listChannels(tx, actor),
  }))

  const unread = threads.reduce((total, thread) => total + (thread.unread > 0 ? 1 : 0), 0)

  return (
    <div className="flex min-h-screen flex-col">
      <EmployeeHeader back={{ href: '/my', label: 'Back' }} />
      <main id="main" className="mx-auto w-full max-w-xl flex-1 px-5 pb-7">
        <EmployeeTitle
          title="Your"
          accent="messages"
          description="Between you and one other person. Nobody else sees these."
        />
        <InboxTabs channels={channels.length} unread={unread} />

        <div className="mt-5 flex flex-col gap-3">
          {threads.length === 0 ? (
            <EmptyState
              title="No conversations yet"
              description="Start one with your manager below."
            />
          ) : (
            threads.map((thread) => (
              <Link
                key={thread.id}
                href={`/my/inbox/messages/${thread.id}`}
                className="rounded-card border-line shadow-low flex items-center gap-3 border bg-white p-4"
              >
                <Avatar name={thread.otherName} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-ink font-semibold">{thread.otherName}</span>
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

        <Card className="mt-6">
          <CardHeader title="Start a conversation" />
          <div className="p-5">
            <StartThread people={people} from="my" />
          </div>
        </Card>
      </main>
    </div>
  )
}
