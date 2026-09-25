import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { canAtAnyLocation } from '@/server/authz/can'
import { weekReview, type WeekReview } from '@/modules/scheduling/slotted'
import { NotFoundError } from '@/lib/errors'
import { formatIsoDate } from '@/modules/scheduling/time'
import { ButtonLink, Card, CardHeader, PageHeader } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'

export const metadata: Metadata = { title: 'Autofill' }
export const dynamic = 'force-dynamic'

/**
 * Autofill, explained.
 *
 * Automation that shows its work: how many people got hours they asked for,
 * who did not, whose time off was respected, what is still open. It is read
 * back from the draft rather than remembered from the run, so it stays true
 * after the manager changes a pick and comes back.
 *
 * NOTHING HERE IS PUBLISHED. Every line is a draft decision the manager owns.
 */
export default async function AutofillPage({
  params,
}: {
  params: Promise<{ scheduleId: string }>
}) {
  const { scheduleId } = await params
  const { actor } = await requireActorContext()
  if (!canAtAnyLocation(actor, 'schedule.draft')) {
    return <PermissionDenied capabilityLabel="Build schedules" />
  }

  const review = await withTenant(actor.organizationId, async (tx) => {
    try {
      return await weekReview(tx, actor, scheduleId)
    } catch (error) {
      if (error instanceof NotFoundError) return null
      throw error
    }
  })
  if (!review) notFound()

  const lines = explain(review)

  return (
    <>
      <PageHeader
        back={{
          href: `/app/schedule?location=${review.locationId}&week=${review.weekStart}`,
          label: 'The week',
        }}
        eyebrow={review.locationName}
        title="Autofill"
        accent="complete"
        description={`${review.filled} of ${review.slots} slots filled from what EverCalm already knows. Nothing is published — every pick is yours to change.`}
      />

      <div className="flex flex-col gap-5 py-7">
        <Card>
          <CardHeader title="How it decided" />
          <ul className="divide-line divide-y">
            {lines.map((line) => (
              <li key={line.headline} className="flex gap-3 px-5 py-4">
                <span aria-hidden="true" className={`text-lg leading-none ${line.tone}`}>
                  {line.mark}
                </span>
                <span>
                  <span className="text-ink block font-medium">{line.headline}</span>
                  <span className="text-muted block text-sm">{line.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <div className="flex flex-wrap gap-2.5">
          <ButtonLink href={`/app/schedule/review/${scheduleId}`} size="lg">
            Keep it and review
          </ButtonLink>
          <ButtonLink
            href={`/app/schedule?location=${review.locationId}&week=${review.weekStart}`}
            variant="secondary"
            size="lg"
          >
            Back to the week
          </ButtonLink>
        </div>
      </div>
    </>
  )
}

interface Line {
  mark: string
  tone: string
  headline: string
  detail: string
}

/** The draft, described. Derived from the week, so it is never out of date. */
function explain(review: WeekReview): Line[] {
  const shifts = review.days.flatMap((day) => day.shifts)
  const filled = shifts.filter((s) => s.assigneeId)
  const preferred = filled.filter((s) => s.state === 'available')
  const notPreferred = filled.filter((s) => s.state === 'not_preferred')
  const overridden = filled.filter((s) => s.state === 'unavailable')
  const open = shifts.filter((s) => !s.assigneeId)
  const breaks = filled.filter((s) => s.breakMinutes > 0)
  const overtime = review.hours.filter((h) => h.minutes > 40 * 60)

  const lines: Line[] = []

  if (preferred.length > 0) {
    lines.push({
      mark: '✓',
      tone: 'text-success',
      headline: `${preferred.length} ${preferred.length === 1 ? 'shift is' : 'shifts are'} inside preferred availability`,
      detail: 'Most people got the hours they asked for.',
    })
  }

  if (notPreferred.length > 0) {
    lines.push({
      mark: '–',
      tone: 'text-warning',
      headline: `${notPreferred.length} not-preferred ${notPreferred.length === 1 ? 'shift' : 'shifts'}`,
      detail: notPreferred
        .slice(0, 3)
        .map((s) => `${(s.assigneeName ?? '').split(' ')[0]} at ${s.time}`)
        .join(', '),
    })
  }

  lines.push({
    mark: '🔒',
    tone: 'text-muted',
    headline: 'Approved time off respected',
    detail: 'Nobody with approved time off was scheduled over it. There is no override for that.',
  })

  lines.push({
    mark: overtime.length === 0 ? '✓' : '!',
    tone: overtime.length === 0 ? 'text-success' : 'text-danger',
    headline: overtime.length === 0 ? 'No overtime' : `${overtime.length} over 40 hours`,
    detail:
      overtime.length === 0
        ? 'Everyone stays at or under 40 hours.'
        : overtime.map((h) => `${h.displayName} at ${Math.round(h.minutes / 60)} h`).join(', '),
  })

  if (breaks.length > 0) {
    lines.push({
      mark: '✓',
      tone: 'text-success',
      headline: `${breaks.length} meal breaks placed`,
      detail: 'From your template’s break rules, staggered so the floor stays covered.',
    })
  }

  if (overridden.length > 0) {
    lines.push({
      mark: '×',
      tone: 'text-danger',
      headline: `${overridden.length} scheduled against their availability`,
      detail: 'Your decision, recorded — you will see it again before publishing.',
    })
  }

  if (open.length > 0) {
    lines.push({
      mark: '–',
      tone: 'text-warning',
      headline: `${open.length} ${open.length === 1 ? 'slot' : 'slots'} left open`,
      detail: `${open
        .slice(0, 3)
        .map((s) => `${s.roleName ?? 'Shift'} ${s.time}`)
        .join('; ')} — nobody qualified is free.`,
    })
  } else {
    lines.push({
      mark: '✓',
      tone: 'text-success',
      headline: 'Every slot is filled',
      detail: `All ${review.slots} of them, for the week of ${formatIsoDate(review.weekStart)}.`,
    })
  }

  return lines
}
