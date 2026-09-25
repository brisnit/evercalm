import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { canAtAnyLocation } from '@/server/authz/can'
import { getChannel } from '@/modules/messaging/service'
import { postToChannelAction } from '@/modules/messaging/actions'
import { ForbiddenError, NotFoundError } from '@/lib/errors'
import { Badge, PageHeader } from '@/ui/primitives'
import { NoticeProvider } from '@/ui/patterns/notice-provider'
import { MiniForm } from '@/ui/patterns/mini-form'
import { archiveChannelAction } from '@/modules/messaging/actions'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { MessageComposer } from '@/ui/patterns/message-composer'
import { MessageList } from '@/ui/patterns/message-list'

export const metadata: Metadata = { title: 'Channel' }
export const dynamic = 'force-dynamic'

export default async function ChannelPage({ params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params
  const { actor } = await requireActorContext()
  if (!canAtAnyLocation(actor, 'announcement.create')) {
    return <PermissionDenied capabilityLabel="Use communication" />
  }

  const canManage = canAtAnyLocation(actor, 'conversation.moderate')
  const channel = await withTenant(actor.organizationId, async (tx) => {
    try {
      return await getChannel(tx, actor, channelId)
    } catch (error) {
      if (error instanceof NotFoundError) return null
      if (error instanceof ForbiddenError) return 'forbidden' as const
      throw error
    }
  })

  if (channel === null) notFound()
  if (channel === 'forbidden') return <PermissionDenied capabilityLabel="Read this channel" />

  return (
    <>
      <PageHeader
        back={{ href: '/app/comms/channels', label: 'Channels' }}
        title="#"
        accent={channel.name}
        description={channel.purpose ?? undefined}
      />

      <div className="py-7">
        <p className="mb-5">
          <Badge tone={channel.audience === 'managers' ? 'warning' : 'neutral'}>
            {channel.audience === 'managers' ? 'Managers only' : 'Everyone'}
          </Badge>
        </p>

        <MessageList
          messages={channel.messages.map((m) => ({ ...m, authorName: m.authorName }))}
          emptyTitle="Nothing here yet"
          emptyBody="Say the first thing. Everyone in this channel will see it next time they open the app."
        />

        <div className="mt-6">
          <MessageComposer
            action={postToChannelAction}
            hidden={{ channelId }}
            label={`Message #${channel.name}`}
            placeholder={`Message #${channel.name}`}
          />
        </div>

        {canManage ? (
          <div className="border-line mt-10 border-t pt-5">
            <p className="text-muted mb-3 text-sm">
              Archiving keeps everything said here and frees the slot for another channel.
            </p>
            <NoticeProvider>
              <MiniForm
                action={archiveChannelAction}
                hidden={{ channelId }}
                submitLabel={`Archive #${channel.name}`}
                variant="ghost"
                size="sm"
              />
            </NoticeProvider>
          </div>
        ) : null}
      </div>
    </>
  )
}
