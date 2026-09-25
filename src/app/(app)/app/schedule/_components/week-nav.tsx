'use client'

import Link from 'next/link'
import { ButtonLink } from '@/ui/primitives'

/** Previous and next week, as links so the browser's back button still works. */
export function WeekNav({
  locationId,
  previous,
  next,
  current,
}: {
  locationId: string
  previous: string
  next: string
  current: string
}) {
  return (
    <div className="flex items-center gap-2">
      <ButtonLink
        href={`/app/schedule?location=${locationId}&week=${previous}`}
        variant="secondary"
        size="sm"
      >
        ← Previous
      </ButtonLink>
      <ButtonLink
        href={`/app/schedule?location=${locationId}&week=${next}`}
        variant="secondary"
        size="sm"
      >
        Next →
      </ButtonLink>
      <Link
        href={`/app/schedule?location=${locationId}`}
        className="text-muted hover:text-ink ms-1 text-sm underline-offset-4 hover:underline"
        aria-current={undefined}
      >
        This week
      </Link>
      <span className="sr-only">Showing the week of {current}</span>
    </div>
  )
}
