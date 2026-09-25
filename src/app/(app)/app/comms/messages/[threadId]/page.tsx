import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { canAtAnyLocation } from '@/server/authz/can'
import { getThread, markThreadRead } from '@/modules/messaging/service'
import { sendDirectMessageAction } from '@/modules/messaging/actions'
import { NotFoundError } from '@/lib/errors'
import { PageHeader } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { MessageComposer } from '@/ui/patterns/message-composer'
import { MessageList } from '@/ui/patterns/message-list'

export const metadata: Metadata = { title: 'Conversation' }
export const dynamic = 'force-dynamic'

export default async function ThreadPage({ params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await params
  const { actor } = await requireActorContext()
  if (!canAtAnyLocation(actor, 'announcement.create')) {
    return <PermissionDenied capabilityLabel="Use communication" />
  }

  const thread = await withTenant(actor.organizationId, async (tx) => {
    try {
      // Opening it is reading it, so the other person stops seeing "unread".
      await markThreadRead(tx, actor, threadId)
      return await getThread(tx, actor, threadId)
    } catch (error) {
      if (error instanceof NotFoundError) return null
      throw error
    }
  })

  if (!thread) notFound()

  return (
    <>
      <PageHeader
        back={{ href: '/app/comms/messages', label: 'Messages' }}
        title={thread.otherName}
        description={thread.otherJobTitle ?? undefined}
      />

      <div className="py-7">
        <MessageList
          messages={thread.messages.map((m) => ({
            ...m,
            authorName: m.mine ? 'You' : thread.otherName,
          }))}
          emptyTitle="No messages yet"
          emptyBody={`Say hello to ${thread.otherName.split(' ')[0]}.`}
          showAuthor={false}
        />
        <div className="mt-6">
          <MessageComposer
            action={sendDirectMessageAction}
            hidden={{ threadId }}
            label={`Message ${thread.otherName}`}
            placeholder={`Message ${thread.otherName.split(' ')[0]}`}
          />
        </div>
      </div>
    </>
  )
}
