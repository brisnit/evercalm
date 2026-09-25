import { Avatar } from '@/ui/primitives'
import { cn } from '@/lib/cn'

/**
 * A conversation, oldest first.
 *
 * Your own messages sit on the right in coral; everyone else's on the left in
 * white with their name above. Side and colour agree, and the name is always
 * written, so which of the two is speaking never rests on colour alone.
 */
export function MessageList({
  messages,
  emptyTitle,
  emptyBody,
  showAuthor = true,
}: {
  messages: { id: string; body: string; createdAt: Date; authorName?: string; mine: boolean }[]
  emptyTitle: string
  emptyBody: string
  showAuthor?: boolean
}) {
  if (messages.length === 0) {
    return (
      <div className="border-line rounded-card border border-dashed px-5 py-8 text-center">
        <p className="text-ink text-sm font-semibold">{emptyTitle}</p>
        <p className="text-muted mt-1 text-sm">{emptyBody}</p>
      </div>
    )
  }

  return (
    <ol className="flex flex-col gap-4">
      {messages.map((message) => (
        <li
          key={message.id}
          className={cn('flex max-w-full gap-3', message.mine ? 'flex-row-reverse' : 'flex-row')}
        >
          {showAuthor && message.authorName ? <Avatar name={message.authorName} size="sm" /> : null}
          <div className={cn('max-w-[min(34rem,85%)] min-w-0')}>
            <p className={cn('text-faint mb-1 text-xs', message.mine ? 'text-end' : 'text-start')}>
              {message.mine ? 'You' : (message.authorName ?? 'Them')} ·{' '}
              <time dateTime={message.createdAt.toISOString()}>
                {message.createdAt.toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </time>
            </p>
            <p
              className={cn(
                'rounded-card px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap',
                message.mine ? 'bg-action text-white' : 'border-line text-ink border bg-white',
              )}
            >
              {message.body}
            </p>
          </div>
        </li>
      ))}
    </ol>
  )
}
