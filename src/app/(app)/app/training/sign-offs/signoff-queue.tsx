'use client'

import { useActionState, useCallback, useRef } from 'react'
import { decideSignoffAction, type TrainingActionState } from '@/modules/training/actions'
import type { ContentItem } from '@/modules/training/content'
import { ActionNotice, useActionNotice } from '@/ui/patterns/action-notice'
import { AnnouncementBody } from '@/ui/patterns/announcement-body'
import { Badge, Button, Card, Disclosure, EmptyState } from '@/ui/primitives'
import { TEXTAREA_CLASS } from '../_components/styles'

interface Request {
  progressId: string
  personName: string
  locations: string
  courseTitle: string
  versionNumber: number
  lessonTitle: string
  body: string
  criteria: ContentItem[]
  askedLabel: string
  previous: { label: string; note: string }[]
}

export function SignoffQueue({ requests }: { requests: Request[] }) {
  const { notice, show, dismiss } = useActionNotice()
  return (
    <div className="flex flex-col gap-4">
      <ActionNotice notice={notice} onDismiss={dismiss} />
      {requests.length === 0 ? (
        <EmptyState
          title="Nothing waiting"
          description="When someone asks for a practical sign-off, it appears here."
        />
      ) : (
        <ul className="grid gap-4 xl:grid-cols-2">
          {requests.map((request) => (
            <li key={request.progressId}>
              <SignoffCard request={request} onDone={show} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const IDLE: TrainingActionState = { status: 'idle' }

function SignoffCard({
  request,
  onDone,
}: {
  request: Request
  onDone: (state: TrainingActionState) => void
}) {
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone
  const run = useCallback(async (previous: TrainingActionState, formData: FormData) => {
    const result = await decideSignoffAction(previous, formData)
    if (result.status === 'success') onDoneRef.current(result)
    return result
  }, [])
  const [state, formAction, pending] = useActionState(run, IDLE)
  const id = request.progressId

  return (
    <Card as="article" className="h-full">
      <header className="border-line border-b px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-ink text-sm font-semibold">{request.personName}</p>
          <Badge tone="violet">{request.askedLabel}</Badge>
        </div>
        <p className="text-muted text-xs">
          {request.locations} · {request.courseTitle}, version {request.versionNumber}
        </p>
        <h2 className="font-display text-ink mt-2 text-base font-bold">{request.lessonTitle}</h2>
      </header>

      <div className="flex flex-col gap-4 p-5">
        {request.body ? (
          <Disclosure label="What they were asked to do">
            <AnnouncementBody body={request.body} />
          </Disclosure>
        ) : null}

        {request.previous.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {request.previous.map((p, i) => (
              <li key={i} className="rounded-control bg-raise border-line border px-3 py-2 text-sm">
                <span className="text-muted block text-xs">{p.label}</span>
                {p.note ? <span className="text-ink">{p.note}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}

        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="progressId" value={id} />
          {state.status === 'error' && state.message ? (
            <p
              role="alert"
              className="rounded-control border-danger/30 bg-danger-soft text-danger border px-3 py-2 text-sm font-medium"
            >
              {state.message}
            </p>
          ) : null}
          <fieldset className="flex flex-col gap-1">
            <legend className="text-ink mb-1.5 text-sm font-medium">What you saw them do</legend>
            {request.criteria.map((c) => (
              <label
                key={c.id}
                className="hover:bg-sunk rounded-control text-ink flex min-h-11 items-start gap-2.5 px-2 py-2 text-sm"
              >
                <input
                  type="checkbox"
                  name="criteria"
                  value={c.id}
                  className="mt-0.5 size-4 accent-violet-600"
                />
                {c.text}
              </label>
            ))}
          </fieldset>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`note-${id}`} className="text-ink text-sm font-medium">
              Note for {request.personName.split(' ')[0]}
            </label>
            <p id={`note-${id}-hint`} className="text-muted text-xs">
              Needed if you send it back: say what to practise.
            </p>
            <textarea
              id={`note-${id}`}
              name="note"
              rows={2}
              maxLength={500}
              aria-describedby={`note-${id}-hint`}
              className={TEXTAREA_CLASS}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" name="decision" value="verified" loading={pending}>
              Sign off
            </Button>
            <Button
              type="submit"
              name="decision"
              value="returned"
              variant="secondary"
              disabled={pending}
            >
              Send back to practise
            </Button>
          </div>
        </form>
      </div>
    </Card>
  )
}
