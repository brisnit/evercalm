import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { EmployeeShell } from '../../../_components/employee-shell'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { getThread, markThreadRead } from '@/modules/messaging/service'
import { sendDirectMessageAction } from '@/modules/messaging/actions'
import { NotFoundError } from '@/lib/errors'
import { MessageComposer } from '@/ui/patterns/message-composer'
import { MessageList } from '@/ui/patterns/message-list'

export const metadata: Metadata = { title: 'Conversation' }
export const dynamic = 'force-dynamic'

export default async function StaffThreadPage({
  params,
}: {
  params: Promise<{ threadId: string }>
}) {
  const { threadId } = await params
  const { actor } = await requireActorContext()

  const thread = await withTenant(actor.organizationId, async (tx) => {
    try {
      await markThreadRead(tx, actor, threadId)
      return await getThread(tx, actor, threadId)
    } catch (error) {
      if (error instanceof NotFoundError) return null
      throw error
    }
  })
  if (!thread) notFound()

  return (
    <EmployeeShell back={{ href: '/my/inbox/messages', label: 'Messages' }}>
      <h1 className="font-display text-ink text-[1.625rem] leading-tight font-extrabold tracking-tight">
        {thread.otherName}
      </h1>
      {thread.otherJobTitle ? (
        <p className="text-muted mt-1 text-sm">{thread.otherJobTitle}</p>
      ) : null}

      <div className="mt-6">
        <MessageList
          messages={thread.messages.map((m) => ({
            ...m,
            authorName: m.mine ? 'You' : thread.otherName,
          }))}
          emptyTitle="No messages yet"
          emptyBody="Say what you need. Only the two of you can see this."
          showAuthor={false}
        />
      </div>

      <div className="mt-6">
        <MessageComposer
          action={sendDirectMessageAction}
          hidden={{ threadId }}
          label={`Message ${thread.otherName}`}
          placeholder={`Message ${thread.otherName.split(' ')[0]}`}
        />
      </div>
    </EmployeeShell>
  )
}
