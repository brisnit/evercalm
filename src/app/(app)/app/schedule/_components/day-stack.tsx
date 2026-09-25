'use client'

import Link from 'next/link'
import { useState } from 'react'
import { cn } from '@/lib/cn'
import { AvailabilityPill } from '@/ui/patterns/availability-pill'
import type { WeekReview } from '@/modules/scheduling/slotted'

/**
 * The week, at two densities.
 *
 * Phone: a day strip, one day open on the screen at a time, the rest collapsed
 * to a line each — a shrunken spreadsheet is unreadable in a doorway.
 * Desktop: every day as a column, dense and direct, because at a desk the
 * shape of the week is the thing worth seeing.
 *
 * Both render the same data and neither hides anything the other shows.
 */

const WEEKDAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function dayLabel(date: string): { short: string; number: string } {
  const at = new Date(`${date}T12:00:00Z`)
  return {
    short: WEEKDAY[(at.getUTCDay() + 6) % 7] ?? '',
    number: String(at.getUTCDate()),
  }
}

function stateMark(state: WeekReview['days'][number]['state']): {
  mark: string
  label: string
  tone: string
} {
  if (state === 'approved') return { mark: '✓', label: 'Approved', tone: 'text-success' }
  if (state === 'flagged') return { mark: '!', label: 'Flagged', tone: 'text-danger' }
  return { mark: '·', label: 'Not reviewed', tone: 'text-faint' }
}

export function DayStack({ review, canDraft }: { review: WeekReview; canDraft: boolean }) {
  const [open, setOpen] = useState(
    review.days.find((day) => day.slots > 0)?.date ?? review.days[0]?.date ?? '',
  )

  return (
    <>
      {/* Phone */}
      <div className="lg:hidden">
        {/*
          The strip scrolls inside its own box, bleeding to the screen edges so
          the last day is visibly cut off rather than hidden. The scroller is
          the wrapper, not the list: a list that sizes itself to its content
          pushes the page sideways instead of scrolling.
        */}
        <div className="-mx-5 mb-4 [scrollbar-width:none] overflow-x-auto px-5">
          <ul className="flex w-max gap-2">
            {review.days.map((day) => {
              const label = dayLabel(day.date)
              const mark = stateMark(day.state)
              const active = day.date === open
              return (
                <li key={day.date}>
                  <button
                    type="button"
                    onClick={() => setOpen(day.date)}
                    aria-pressed={active}
                    // The state is on the button itself rather than in a
                    // visually-hidden span: an absolutely positioned child
                    // inside a horizontal scroller escapes it and drags the
                    // whole page sideways.
                    aria-label={`${label.short} ${label.number} — ${mark.label}`}
                    className={cn(
                      'flex min-w-14 flex-col items-center rounded-2xl border px-3 py-2 transition-colors',
                      active ? 'bg-band border-band text-white' : 'border-line text-muted bg-white',
                    )}
                  >
                    <span className="text-xs font-medium">{label.short}</span>
                    <span className="text-lg font-semibold tabular-nums">{label.number}</span>
                    <span
                      aria-hidden="true"
                      className={cn('text-xs', active ? 'text-white' : mark.tone)}
                    >
                      {mark.mark}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>

        {review.days
          .filter((day) => day.date === open)
          .map((day) => (
            <DayPanel key={day.date} day={day} review={review} canDraft={canDraft} />
          ))}
      </div>

      {/* Desktop */}
      <div className="hidden gap-3 lg:grid lg:grid-cols-7">
        {review.days.map((day) => {
          const label = dayLabel(day.date)
          const mark = stateMark(day.state)
          return (
            <section
              key={day.date}
              aria-label={`${label.short} ${label.number}`}
              className="rounded-card border-line shadow-low flex flex-col border bg-white"
            >
              <header className="border-line border-b px-3 py-2.5">
                <p className="text-ink flex items-center gap-1.5 text-sm font-semibold">
                  {label.short} {label.number}
                  <span className={mark.tone}>
                    <span aria-hidden="true">{mark.mark}</span>
                    <span className="sr-only">{mark.label}</span>
                  </span>
                </p>
                <p className="text-muted text-xs tabular-nums">
                  {day.slots === 0
                    ? 'No schedule'
                    : `${day.filled}/${day.slots} · ${Math.round(day.staffMinutes / 60)} h`}
                </p>
              </header>
              {day.slots === 0 ? (
                <p className="text-faint flex flex-1 items-center justify-center p-4 text-sm">
                  Closed
                </p>
              ) : (
                <ul className="flex flex-1 flex-col gap-1.5 p-2">
                  {day.shifts.map((shift) => (
                    <li key={shift.id}>
                      <SlotCell shift={shift} canDraft={canDraft} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </div>
    </>
  )
}

function DayPanel({
  day,
  review,
  canDraft,
}: {
  day: WeekReview['days'][number]
  review: WeekReview
  canDraft: boolean
}) {
  return (
    <section className="rounded-card border-line shadow-low border bg-white">
      <header className="border-line flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <p className="text-ink font-semibold">
          {day.slots === 0 ? 'Closed — no schedule' : `${day.filled} of ${day.slots} filled`}
        </p>
        <p className="text-muted text-sm tabular-nums">
          {Math.round(day.staffMinutes / 60)} staff hours · {day.breaks} breaks
        </p>
      </header>
      {day.issues.length > 0 ? (
        <ul className="border-line divide-line divide-y border-b">
          {day.issues.map((issue, index) => (
            <li key={index} className="text-warning px-4 py-2 text-sm">
              {issue.message}
            </li>
          ))}
        </ul>
      ) : null}
      <ul className="divide-line divide-y">
        {day.shifts.map((shift) => (
          <li key={shift.id} className="px-4 py-3">
            <SlotCell shift={shift} canDraft={canDraft} wide />
          </li>
        ))}
      </ul>
      {canDraft ? (
        <div className="border-line border-t px-4 py-3">
          <Link
            href={`/app/schedule/review/${review.scheduleId}/${day.date}`}
            className="text-action text-sm font-semibold underline-offset-4 hover:underline"
          >
            Open the full day
          </Link>
        </div>
      ) : null}
    </section>
  )
}

function SlotCell({
  shift,
  canDraft,
  wide = false,
}: {
  shift: WeekReview['days'][number]['shifts'][number]
  canDraft: boolean
  wide?: boolean
}) {
  const body = (
    <>
      <span className="text-faint block text-[0.6875rem] font-medium tracking-wide uppercase">
        {shift.roleName ?? 'Any role'} · {shift.time}
      </span>
      {shift.assigneeName ? (
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
          <span className="text-ink text-sm font-medium">{shift.assigneeName}</span>
          {shift.state ? <AvailabilityPill state={shift.state} compact={!wide} /> : null}
          {shift.overridden ? (
            <span className="text-danger text-xs font-semibold">Overridden</span>
          ) : null}
        </span>
      ) : (
        <span className="text-faint mt-0.5 block text-sm italic">Empty slot</span>
      )}
    </>
  )

  const className = cn(
    'block rounded-control border px-2.5 py-2 text-start transition-colors',
    shift.assigneeName
      ? 'border-line bg-white hover:border-line-strong'
      : 'border-line-strong border-dashed bg-sunk hover:bg-white',
  )

  if (!canDraft) return <span className={className}>{body}</span>
  return (
    <Link href={`/app/schedule/slots/${shift.id}`} className={className}>
      {body}
    </Link>
  )
}
