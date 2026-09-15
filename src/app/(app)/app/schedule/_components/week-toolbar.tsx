'use client'

import Link from 'next/link'
import { Select } from '@/ui/primitives'
import { buttonClasses } from '@/ui/primitives/button'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'

/**
 * Location and week. A real navigation - the address carries both - so a
 * week can be bookmarked, shared, and refreshed without losing place.
 */
export function WeekToolbar({
  locations,
  locationId,
  weekStart,
  previousWeek,
  nextWeek,
  thisWeek,
  basePath = '/app/schedule',
}: {
  locations: { id: string; name: string }[]
  locationId: string
  weekStart: string
  previousWeek: string
  nextWeek: string
  thisWeek: string
  basePath?: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const href = (week: string, location = locationId) =>
    `${basePath}?location=${location}&week=${week}`
  const linkClass = buttonClasses('secondary', 'md', 'px-3')

  return (
    <div className="flex flex-wrap items-end gap-2" aria-busy={pending || undefined}>
      {locations.length > 1 ? (
        <div className="flex min-w-48 flex-col gap-1">
          <label htmlFor="schedule-location" className="text-muted text-xs font-medium">
            Location
          </label>
          <Select
            id="schedule-location"
            value={locationId}
            onChange={(e) => startTransition(() => router.push(href(weekStart, e.target.value)))}
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </div>
      ) : null}

      <nav aria-label="Week" className="flex flex-wrap gap-2">
        <Link href={href(previousWeek)} className={linkClass}>
          <span aria-hidden="true">←</span>&nbsp;Previous week
        </Link>
        {weekStart !== thisWeek ? (
          <Link href={href(thisWeek)} className={linkClass}>
            This week
          </Link>
        ) : null}
        <Link href={href(nextWeek)} className={linkClass}>
          Next week&nbsp;<span aria-hidden="true">→</span>
        </Link>
      </nav>
    </div>
  )
}
