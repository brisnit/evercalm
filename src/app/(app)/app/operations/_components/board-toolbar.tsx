'use client'

import Link from 'next/link'
import { Select } from '@/ui/primitives'
import { buttonClasses } from '@/ui/primitives/button'
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
  const linkClass = buttonClasses('secondary', 'md', 'px-3')

  if (locations.length <= 1 && !date) return null

  return (
    <div className="flex flex-wrap items-end gap-2" aria-busy={pending || undefined}>
      {locations.length > 1 ? (
        <div className="flex min-w-48 flex-col gap-1">
          <label htmlFor="operations-location" className="text-muted text-xs font-medium">
            Location
          </label>
          <Select
            id="operations-location"
            value={locationId}
            onChange={(e) => startTransition(() => router.push(href(date, e.target.value)))}
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
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
