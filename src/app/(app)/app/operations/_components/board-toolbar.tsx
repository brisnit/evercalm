'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'

/** Location and business date, carried in the address so a day can be shared and refreshed. */
export function BoardToolbar({
  basePath,
  locations,
  locationId,
  date,
  previousDate,
  nextDate,
  today,
}: {
  basePath: string
  locations: { id: string; name: string }[]
  locationId: string
  date?: string
  previousDate?: string
  nextDate?: string
  today?: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const href = (d: string | undefined, location = locationId) =>
    `${basePath}?location=${location}${d ? `&date=${d}` : ''}`
  const linkClass =
    'rounded-control border-line-strong text-ink hover:bg-sunk inline-flex min-h-11 items-center border bg-white px-3 text-sm font-medium'

  if (locations.length <= 1 && !date) return null

  return (
    <div
      className="rounded-card border-line bg-raise flex flex-wrap items-end gap-3 border p-3"
      aria-busy={pending || undefined}
    >
      {locations.length > 1 ? (
        <div className="flex min-w-44 flex-col gap-1.5">
          <label htmlFor="operations-location" className="text-muted text-xs font-medium">
            Location
          </label>
          <select
            id="operations-location"
            value={locationId}
            onChange={(e) => startTransition(() => router.push(href(date, e.target.value)))}
            className="rounded-control border-line-strong text-ink hover:border-faint min-h-11 border bg-white px-3 text-sm focus:border-violet-600"
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {date && previousDate && nextDate && today ? (
        <nav aria-label="Day" className="flex flex-wrap gap-2">
          <Link href={href(previousDate)} className={linkClass}>
            <span aria-hidden="true">←</span>&nbsp;Previous day
          </Link>
          {date !== today ? (
            <Link href={href(today)} className={linkClass}>
              Today
            </Link>
          ) : null}
          <Link href={href(nextDate)} className={linkClass}>
            Next day&nbsp;<span aria-hidden="true">→</span>
          </Link>
        </nav>
      ) : null}
    </div>
  )
}
