import type { Metadata } from 'next'
import Link from 'next/link'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { canAtAnyLocation } from '@/server/authz/can'
import { countChannels, listChannels, MAX_CUSTOM_CHANNELS } from '@/modules/messaging/service'
import { Badge, Card, CardHeader, EmptyState, PageHeader } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { NoticeProvider } from '@/ui/patterns/notice-provider'
import { ChannelForm } from './channel-form'

export const metadata: Metadata = { title: 'Channels' }
export const dynamic = 'force-dynamic'

/**
 * Channels.
 *
 * Two, at most, on purpose. A team that can reach everything it said this week
 * in two rooms actually reads it; twenty rooms is where things get missed, and
 * an operator who wants that already has Slack. The ceiling is enforced by the
 * service, so it holds however the page is called.
 */
export default async function ChannelsPage() {
  const { actor } = await requireActorContext()
  if (!canAtAnyLocation(actor, 'announcement.create')) {
    return <PermissionDenied capabilityLabel="Use communication" />
  }

  const canManage = canAtAnyLocation(actor, 'conversation.moderate')
  const { list, total } = await withTenant(actor.organizationId, async (tx) => ({
    list: await listChannels(tx, actor),
    total: await countChannels(tx, actor),
  }))

  const remaining = MAX_CUSTOM_CHANNELS - total

  return (
    <>
      <PageHeader
        title="Channels"
        description="The running conversation of the business. Two rooms, so nothing gets lost in a twentieth."
      />

      <div className="mt-7 grid gap-5 lg:grid-cols-[1.6fr_1fr] lg:items-start">
        <div className="flex flex-col gap-4">
          {list.length === 0 ? (
            <EmptyState
              title="No channels yet"
              description={
                canManage
                  ? 'Open one for the conversation that keeps repeating in the group chat.'
                  : 'An owner opens these. Announcements and direct messages are ready to use now.'
              }
            />
          ) : (
            list.map((channel) => (
              <Link
                key={channel.id}
                href={`/app/comms/channels/${channel.id}`}
                className="rounded-card border-line shadow-low hover:shadow-lift block border bg-white p-5 transition-shadow"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-ink text-base font-semibold">#{channel.name}</h2>
                  <Badge tone={channel.audience === 'managers' ? 'warning' : 'neutral'}>
                    {channel.audience === 'managers' ? 'Managers only' : 'Everyone'}
                  </Badge>
                </div>
                {channel.purpose ? (
                  <p className="text-muted mt-1 text-sm">{channel.purpose}</p>
                ) : null}
                <p className="text-faint mt-3 text-sm">
                  {channel.lastBody ? (
                    <>
                      <span className="text-muted font-medium">{channel.lastAuthor}:</span>{' '}
                      <span className="text-muted">
                        {channel.lastBody.length > 120
                          ? `${channel.lastBody.slice(0, 120).trimEnd()}…`
                          : channel.lastBody}
                      </span>
                    </>
                  ) : (
                    'Nothing posted yet.'
                  )}
                </p>
                <p className="text-faint mt-2 text-xs">
                  {channel.messageCount} {channel.messageCount === 1 ? 'message' : 'messages'}
                </p>
              </Link>
            ))
          )}
        </div>

        {canManage ? (
          <Card>
            <CardHeader
              title={remaining > 0 ? 'Open a channel' : 'Both channels are open'}
              description={
                remaining > 0
                  ? `${remaining} of ${MAX_CUSTOM_CHANNELS} left. Two is the limit, so every room stays worth reading.`
                  : `EverCalm allows ${MAX_CUSTOM_CHANNELS}. Archive one to open another - its history is kept.`
              }
            />
            {remaining > 0 ? (
              <div className="p-5">
                <NoticeProvider>
                  <ChannelForm />
                </NoticeProvider>
              </div>
            ) : null}
          </Card>
        ) : null}
      </div>
    </>
  )
}
