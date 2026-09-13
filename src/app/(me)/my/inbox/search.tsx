'use client'

import { Input } from '@/ui/primitives'

/**
 * Inbox search.
 *
 * A plain GET form, so it works without JavaScript, keeps the query in the URL
 * (shareable, back-button friendly) and needs no client state. The current
 * filter and category ride along as hidden fields so searching does not throw
 * away what the person had narrowed to.
 */
export function InboxSearch({
  defaultValue,
  filter,
  category,
}: {
  defaultValue: string
  filter: string
  category?: string
}) {
  return (
    <form action="/my/inbox" method="get" role="search" className="flex gap-2">
      {filter !== 'all' ? <input type="hidden" name="filter" value={filter} /> : null}
      {category ? <input type="hidden" name="category" value={category} /> : null}

      <label htmlFor="inbox-search" className="sr-only">
        Search your messages
      </label>
      <Input
        id="inbox-search"
        name="q"
        type="search"
        defaultValue={defaultValue}
        placeholder="Search your messages"
        className="flex-1"
      />
      <button
        type="submit"
        className="rounded-control border-line-strong text-ink hover:bg-sunk min-h-11 shrink-0 border bg-white px-4 text-sm font-medium"
      >
        Search
      </button>
    </form>
  )
}
