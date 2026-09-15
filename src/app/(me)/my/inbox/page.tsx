import type { Metadata } from 'next'
import Link from 'next/link'
import { EmployeeHeader } from '../_components/employee-shell'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import {
  inboxCategories,
  listInbox,
  outstandingAcknowledgement,
  type InboxFilter,
} from '@/modules/comms/inbox'
import { Badge, Card, EmptyState } from '@/ui/primitives'
import { PriorityMark, PriorityRail } from '@/ui/patterns/priority-mark'
import { organizationTimeZone } from '@/modules/comms/service'
import { formatDateInZone } from '@/lib/dates'
import { InboxSearch } from './search'

export const metadata: Metadata = { title: 'Your inbox' }
export const dynamic = 'force-dynamic'

/**
 * The employee inbox, mobile first.
 *
 * One question above all: what needs me. Anything awaiting acknowledgement is
 * first and says so in words; urgent unread notices follow; everything else is
 * newest first. Nothing is hidden by the filters - they narrow, and the count
 * on each says what narrowing costs.
 */

const FILTERS: { value: InboxFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'acknowledge', label: 'Needs you' },
  { value: 'archived', label: 'Archived' },
]

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; category?: string; q?: string }>
}) {
  const params = await searchParams
  const { actor } = await requireActorContext()

  const filter: InboxFilter = FILTERS.some((f) => f.value === params.filter)
    ? (params.filter as InboxFilter)
    : 'all'
  const search = params.q?.trim() || undefined

  const { items, categories, everything, timeZone } = await withTenant(
    actor.organizationId,
    async (tx) => ({
      items: await listInbox(tx, actor, actor.employmentId, {
        filter,
        categoryKey: params.category,
        search,
      }),
      categories: await inboxCategories(tx, actor, actor.employmentId),
      everything: await listInbox(tx, actor, actor.employmentId, { filter: 'all' }),
      timeZone: await organizationTimeZone(tx, actor.organizationId),
    }),
  )

  const unreadCount = everything.filter((i) => i.unread).length
  const needsYou = everything.filter(outstandingAcknowledgement).length

  return (
    <div className="flex min-h-screen flex-col">
      <EmployeeHeader back={{ href: '/my', label: 'Back' }} />

      <main id="main" className="mx-auto w-full max-w-xl flex-1 px-5 py-7">
        <h1 className="font-display text-ink text-[1.625rem] leading-tight font-extrabold tracking-tight">
          Your inbox
        </h1>
        <p className="text-muted mt-1.5 text-sm">
          {needsYou > 0
            ? `${needsYou} ${needsYou === 1 ? 'message needs' : 'messages need'} your confirmation.`
            : unreadCount > 0
              ? `${unreadCount} unread.`
              : 'Everything here is read and confirmed.'}
        </p>

        <nav aria-label="Filter" className="mt-5 flex flex-wrap gap-2">
          {FILTERS.map((option) => {
            const active = option.value === filter
            const count =
              option.value === 'unread'
                ? unreadCount
                : option.value === 'acknowledge'
                  ? needsYou
                  : null
            return (
              <Link
                key={option.value}
                href={buildHref({ filter: option.value, category: params.category, q: search })}
                aria-current={active ? 'page' : undefined}
                className={
                  active
                    ? 'rounded-control bg-violet-600 px-3.5 py-2 text-sm font-semibold text-white'
                    : 'rounded-control border-line text-ink hover:bg-sunk border bg-white px-3.5 py-2 text-sm font-medium'
                }
              >
                {option.label}
                {count !== null && count > 0 ? (
                  <span className={active ? 'ml-1.5 text-white/85' : 'text-muted ml-1.5'}>
                    {count}
                  </span>
                ) : null}
              </Link>
            )
          })}
        </nav>

        {categories.length > 1 ? (
          <nav aria-label="Category" className="mt-3 flex flex-wrap gap-2">
            <Link
              href={buildHref({ filter, q: search })}
              aria-current={!params.category ? 'page' : undefined}
              className={chipClass(!params.category)}
            >
              Every category
            </Link>
            {categories.map((category) => (
              <Link
                key={category.key}
                href={buildHref({ filter, category: category.key, q: search })}
                aria-current={params.category === category.key ? 'page' : undefined}
                className={chipClass(params.category === category.key)}
              >
                {category.name}
              </Link>
            ))}
          </nav>
        ) : null}

        <div className="mt-4">
          <InboxSearch defaultValue={search ?? ''} filter={filter} category={params.category} />
        </div>

        {items.length === 0 ? (
          <div className="mt-6">
            <EmptyState
              title={emptyTitle(filter, search)}
              description={emptyDescription(filter, search)}
            />
          </div>
        ) : (
          <ul className="mt-5 flex flex-col gap-3">
            {items.map((item) => {
              const needsAck = outstandingAcknowledgement(item)
              return (
                <li key={item.recipientId}>
                  <Link href={`/my/inbox/${item.announcementId}`} className="block">
                    <Card
                      className={
                        item.unread
                          ? 'relative overflow-hidden border-violet-300 p-4'
                          : 'relative overflow-hidden p-4'
                      }
                    >
                      <PriorityRail priority={item.priority} />

                      <div className="flex flex-wrap items-center gap-2">
                        {item.unread ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-100 px-2.5 py-1 text-[0.6875rem] font-semibold text-violet-700">
                            <span
                              aria-hidden="true"
                              className="h-1.5 w-1.5 rounded-full bg-violet-600"
                            />
                            Unread
                          </span>
                        ) : null}
                        <PriorityMark priority={item.priority} />
                        {needsAck ? (
                          <Badge tone="warning">
                            {item.needsReacknowledgement
                              ? 'Confirm again'
                              : 'Needs your confirmation'}
                          </Badge>
                        ) : item.requiresAcknowledgement ? (
                          <Badge tone="success">Confirmed</Badge>
                        ) : null}
                        <span className="text-faint ml-auto text-xs">{item.categoryName}</span>
                      </div>

                      <h2
                        className={
                          item.unread
                            ? 'font-display text-ink mt-2.5 text-base font-extrabold'
                            : 'font-display text-ink mt-2.5 text-base font-bold'
                        }
                      >
                        {item.title}
                      </h2>
                      <p className="text-muted mt-1 line-clamp-2 text-sm">{item.preview}</p>

                      <p className="text-faint mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                        {item.authorName ? <span>{item.authorName}</span> : null}
                        {item.publishedAt ? (
                          <span>{formatDateInZone(item.publishedAt, timeZone)}</span>
                        ) : null}
                        {needsAck && item.acknowledgementDueAt ? (
                          <span className="text-warning font-semibold">
                            Due {formatDateInZone(item.acknowledgementDueAt, timeZone)}
                          </span>
                        ) : null}
                        {item.revisedSinceViewed ? (
                          <span className="text-info font-semibold">Updated since you read it</span>
                        ) : null}
                      </p>
                    </Card>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </main>
    </div>
  )
}

function chipClass(active: boolean): string {
  return active
    ? 'rounded-full bg-violet-100 px-3 py-1.5 text-xs font-semibold text-violet-700'
    : 'border-line text-muted hover:text-ink rounded-full border bg-white px-3 py-1.5 text-xs font-medium'
}

function buildHref(options: { filter: InboxFilter; category?: string; q?: string }): string {
  const params = new URLSearchParams()
  if (options.filter !== 'all') params.set('filter', options.filter)
  if (options.category) params.set('category', options.category)
  if (options.q) params.set('q', options.q)
  const query = params.toString()
  return query ? `/my/inbox?${query}` : '/my/inbox'
}

function emptyTitle(filter: InboxFilter, search?: string): string {
  if (search) return 'Nothing matched that search'
  if (filter === 'unread') return 'Nothing unread'
  if (filter === 'acknowledge') return 'Nothing waiting on you'
  if (filter === 'archived') return 'Nothing archived yet'
  return 'No messages yet'
}

function emptyDescription(filter: InboxFilter, search?: string): string {
  if (search) return 'Try a different word, or clear the search to see everything.'
  if (filter === 'unread') return 'You have opened everything sent to you.'
  if (filter === 'acknowledge') return 'Every message that asked for a confirmation has one.'
  if (filter === 'archived') return 'Messages appear here once they expire or are retired.'
  return 'When your manager posts something for your location or role, it appears here.'
}
