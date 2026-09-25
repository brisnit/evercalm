import type { Metadata } from 'next'
import Link from 'next/link'
import { EmployeeHeader, EmployeeTitle } from '../../_components/employee-shell'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { listChannels, unreadThreadCount } from '@/modules/messaging/service'
import { EmptyState } from '@/ui/primitives'
import { InboxTabs } from '@/ui/patterns/inbox-tabs'

export const metadata: Metadata = { title: 'Channels' }
export const dynamic = 'force-dynamic'

export default async function StaffChannelsPage() {
  const { actor } = await requireActorContext()
  const { channels, unread } = await withTenant(actor.organizationId, async (tx) => ({
    channels: await listChannels(tx, actor),
    unread: await unreadThreadCount(tx, actor),
  }))

  return (
    <div className="flex min-h-screen flex-col">
      <EmployeeHeader back={{ href: '/my', label: 'Back' }} />
      <main id="main" className="mx-auto w-full max-w-xl flex-1 px-5 pb-7">
        <EmployeeTitle
          title="Your"
          accent="channels"
          description="What the team is saying, in one place."
        />
        <InboxTabs channels={channels.length} unread={unread} />

        <div className="mt-5 flex flex-col gap-3">
          {channels.length === 0 ? (
            <EmptyState
              title="No channels yet"
              description="Your manager opens these. Notices still arrive on the first tab."
            />
          ) : (
            channels.map((channel) => (
              <Link
                key={channel.id}
                href={`/my/inbox/channels/${channel.id}`}
                className="rounded-card border-line shadow-low block border bg-white p-4"
              >
                <p className="text-ink font-semibold">#{channel.name}</p>
                {channel.purpose ? (
                  <p className="text-muted mt-0.5 text-sm">{channel.purpose}</p>
                ) : null}
                <p className="text-muted mt-2 line-clamp-2 text-sm">
                  {channel.lastBody ? (
                    <>
                      <span className="font-medium">{channel.lastAuthor}:</span> {channel.lastBody}
                    </>
                  ) : (
                    'Nothing posted yet.'
                  )}
                </p>
              </Link>
            ))
          )}
        </div>
      </main>
    </div>
  )
}
