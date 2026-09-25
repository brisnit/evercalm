import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { EmployeeShell } from '../../../_components/employee-shell'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { getChannel } from '@/modules/messaging/service'
import { postToChannelAction } from '@/modules/messaging/actions'
import { ForbiddenError, NotFoundError } from '@/lib/errors'
import { MessageComposer } from '@/ui/patterns/message-composer'
import { MessageList } from '@/ui/patterns/message-list'

export const metadata: Metadata = { title: 'Channel' }
export const dynamic = 'force-dynamic'

export default async function StaffChannelPage({
  params,
}: {
  params: Promise<{ channelId: string }>
}) {
  const { channelId } = await params
  const { actor } = await requireActorContext()

  const channel = await withTenant(actor.organizationId, async (tx) => {
    try {
      return await getChannel(tx, actor, channelId)
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof ForbiddenError) return null
      throw error
    }
  })
  if (!channel) notFound()

  return (
    <EmployeeShell back={{ href: '/my/inbox/channels', label: 'Channels' }}>
      <h1 className="font-display text-ink text-[1.625rem] leading-tight font-extrabold tracking-tight">
        #{channel.name}
      </h1>
      {channel.purpose ? <p className="text-muted mt-1 text-sm">{channel.purpose}</p> : null}

      <div className="mt-6">
        <MessageList
          messages={channel.messages}
          emptyTitle="Nothing here yet"
          emptyBody="Be the first to say something."
        />
      </div>

      <div className="mt-6">
        <MessageComposer
          action={postToChannelAction}
          hidden={{ channelId }}
          label={`Message #${channel.name}`}
          placeholder={`Message #${channel.name}`}
        />
      </div>
    </EmployeeShell>
  )
}
