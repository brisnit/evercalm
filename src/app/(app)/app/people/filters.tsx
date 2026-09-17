'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button, Input } from '@/ui/primitives'

/**
 * Directory filters.
 *
 * A real form that navigates, so filters survive a refresh and can be shared
 * as a link. Search is by name only - searching by email would turn the
 * directory into an existence oracle for addresses.
 */
export function PeopleFilters({ locations }: { locations: { id: string; name: string }[] }) {
  const router = useRouter()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()
  const [query, setQuery] = useState(params.get('q') ?? '')

  function apply(next: Record<string, string>) {
    const search = new URLSearchParams(params.toString())
    for (const [key, value] of Object.entries(next)) {
      if (value) search.set(key, value)
      else search.delete(key)
    }
    startTransition(() => router.push(`/app/people?${search.toString()}`))
  }

  return (
    <form
      className="rounded-card border-line bg-raise flex flex-wrap items-end gap-3 border p-4"
      onSubmit={(event) => {
        event.preventDefault()
        apply({ q: query })
      }}
      role="search"
    >
      <div className="flex min-w-48 flex-1 flex-col gap-1.5">
        <label htmlFor="people-search" className="text-muted text-xs font-medium">
          Search by name
        </label>
        <Input
          id="people-search"
          name="q"
          type="search"
          value={query}
          placeholder="e.g. Marcus"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="flex min-w-44 flex-col gap-1.5">
        <label htmlFor="people-location" className="text-muted text-xs font-medium">
          Location
        </label>
        <select
          id="people-location"
          name="location"
          defaultValue={params.get('location') ?? ''}
          onChange={(e) => apply({ location: e.target.value })}
          className="rounded-control border-line-strong text-ink hover:border-faint min-h-11 border bg-white px-3 text-sm focus:border-teal-600"
        >
          <option value="">All locations</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex min-w-40 flex-col gap-1.5">
        <label htmlFor="people-status" className="text-muted text-xs font-medium">
          Status
        </label>
        <select
          id="people-status"
          name="status"
          defaultValue={params.get('status') ?? ''}
          onChange={(e) => apply({ status: e.target.value })}
          className="rounded-control border-line-strong text-ink hover:border-faint min-h-11 border bg-white px-3 text-sm focus:border-teal-600"
        >
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="invited">Invited</option>
          <option value="suspended">Suspended</option>
          <option value="separated">Separated</option>
        </select>
      </div>

      <Button type="submit" variant="secondary" loading={pending}>
        Search
      </Button>
    </form>
  )
}
