'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'
import { reviewDayAction } from '@/modules/scheduling/slotted-actions'
import type { WeekReview } from '@/modules/scheduling/slotted'
import { Button, ButtonLink } from '@/ui/primitives'
import { AvailabilityPill } from '@/ui/patterns/availability-pill'
import { cn } from '@/lib/cn'

/**
 * One card per day: right approves, left flags, up opens the full day.
 *
 * The gestures are the fast path, never the only path — every one of them has
 * a labelled button underneath, so the whole flow works with a keyboard, a
 * screen reader, or a thumb. The card moves only when motion is welcome;
 * `prefers-reduced-motion` gets the same result with no animation.
 */

const WEEKDAY = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function longDay(date: string): string {
  const at = new Date(`${date}T12:00:00Z`)
  const name = WEEKDAY[(at.getUTCDay() + 6) % 7] ?? ''
  return `${name}, ${at.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })}`
}

export function ReviewStack({ review }: { review: WeekReview }) {
  // Days still to look at, then the flagged ones - which is what "it comes
  // back at the end" means.
  const open = review.days.filter((d) => d.slots > 0)
  const pending = open.filter((d) => d.state === 'pending')
  const flagged = open.filter((d) => d.state === 'flagged')
  const stack = [...pending, ...flagged]

  // The card at the front is always the first unapproved day: approving one
  // redirects back here and it drops out of the stack, so there is no client
  // position to keep in step with the server.
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const form = useRef<HTMLFormElement>(null)
  const [decision, setDecision] = useState<'approved' | 'flagged'>('approved')

  const day = stack[0]

  if (!day) {
    return (
      <div className="rounded-card border-line shadow-low border bg-white p-8 text-center">
        <p className="font-display text-ink text-2xl font-extrabold">Every day is approved.</p>
        <p className="text-muted mt-2">
          {review.overrides.length > 0
            ? `${review.overrides.length} override${review.overrides.length === 1 ? '' : 's'} will be listed again before you publish.`
            : 'Nothing was overridden along the way.'}
        </p>
        <ButtonLink href={`/app/schedule/publish/${review.scheduleId}`} size="lg" className="mt-5">
          Final check
        </ButtonLink>
      </div>
    )
  }

  const submit = (state: 'approved' | 'flagged') => {
    setDecision(state)
    // Let React commit the hidden input before the form goes.
    queueMicrotask(() => form.current?.requestSubmit())
  }

  const offset = drag && start.current ? drag.x - start.current.x : 0
  const lift = drag && start.current ? Math.min(0, drag.y - start.current.y) : 0

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <p className="text-muted text-sm" aria-live="polite">
        {stack.length} {stack.length === 1 ? 'day' : 'days'} to look at
        {flagged.length > 0 ? ` · ${flagged.length} flagged earlier` : ''}
      </p>

      <form ref={form} action={reviewDayAction}>
        <input type="hidden" name="scheduleId" value={review.scheduleId} />
        <input type="hidden" name="onDate" value={day.date} />
        <input type="hidden" name="state" value={decision} />
      </form>

      <article
        className="rounded-card border-line shadow-raise touch-pan-y border bg-white select-none"
        style={
          drag
            ? { transform: `translate(${offset}px, ${lift}px) rotate(${offset / 40}deg)` }
            : undefined
        }
        onPointerDown={(event) => {
          start.current = { x: event.clientX, y: event.clientY }
          setDrag({ x: event.clientX, y: event.clientY })
        }}
        onPointerMove={(event) => {
          if (start.current) setDrag({ x: event.clientX, y: event.clientY })
        }}
        onPointerUp={(event) => {
          const from = start.current
          start.current = null
          setDrag(null)
          if (!from) return
          const dx = event.clientX - from.x
          const dy = event.clientY - from.y
          if (dy < -90 && Math.abs(dy) > Math.abs(dx)) {
            window.location.href = `/app/schedule/review/${review.scheduleId}/${day.date}`
            return
          }
          if (dx > 110) submit('approved')
          else if (dx < -110) submit('flagged')
        }}
      >
        <header className="border-line border-b px-5 py-4">
          <h2 className="font-display text-ink text-2xl font-extrabold">{longDay(day.date)}</h2>
          <p className="text-muted mt-1 text-sm tabular-nums">
            {day.filled} of {day.slots} scheduled · {Math.round(day.staffMinutes / 60)} staff hours
          </p>
        </header>

        <ul className="divide-line divide-y">
          {day.shifts.map((shift) => (
            <li key={shift.id} className="flex flex-wrap items-center gap-2 px-5 py-2.5">
              <span className="text-faint w-40 shrink-0 text-xs font-medium tracking-wide uppercase">
                {shift.roleName ?? 'Any role'} · {shift.time}
              </span>
              {shift.assigneeName ? (
                <>
                  <span className="text-ink text-sm font-medium">{shift.assigneeName}</span>
                  {shift.state ? <AvailabilityPill state={shift.state} compact /> : null}
                </>
              ) : (
                <span className="text-faint text-sm italic">Empty slot</span>
              )}
            </li>
          ))}
        </ul>

        <div
          className={cn(
            'border-line border-t px-5 py-4',
            day.issues.length > 0 ? 'bg-warning-soft' : 'bg-success-soft',
          )}
        >
          {day.issues.length === 0 ? (
            <p className="text-success text-sm font-medium">
              No issues — everyone is on hours they said they could work.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {day.issues.map((issue, i) => (
                <li key={i} className="text-warning text-sm font-medium">
                  {issue.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      </article>

      <div className="grid grid-cols-3 gap-2">
        <Button type="button" variant="secondary" onClick={() => submit('flagged')}>
          ← Flag
        </Button>
        <ButtonLink
          href={`/app/schedule/review/${review.scheduleId}/${day.date}`}
          variant="secondary"
        >
          ↑ Edit
        </ButtonLink>
        <Button type="button" onClick={() => submit('approved')}>
          Approve →
        </Button>
      </div>

      <p className="text-faint text-center text-xs">
        Swipe right to approve, left to flag, up to edit — or use the buttons.
      </p>

      {stack.length > 1 ? (
        <p className="text-muted text-center text-sm">
          Up next:{' '}
          {stack
            .slice(1)
            .map((d) => longDay(d.date).split(',')[0])
            .join(' · ') || 'nothing'}
        </p>
      ) : null}

      <Link
        href={`/app/schedule?location=${review.locationId}&week=${review.weekStart}`}
        className="text-muted hover:text-ink text-center text-sm underline-offset-4 hover:underline"
      >
        Back to the week
      </Link>
    </div>
  )
}
