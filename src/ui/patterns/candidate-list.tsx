'use client'

import { useActionState, useState } from 'react'
import {
  assignToSlotAction,
  clearSlotAction,
  fillCalloutAction,
  type SlottedActionState,
} from '@/modules/scheduling/slotted-actions'
import type { Candidate } from '@/modules/scheduling/slotted'
import type { AvailabilityState } from '@/modules/scheduling/availability-state'
import { AVAILABILITY_LABELS } from '@/modules/scheduling/availability-state'
import { Avatar, Button, Card, CardHeader } from '@/ui/primitives'
import { AvailabilityPill } from './availability-pill'

const IDLE: SlottedActionState = { status: 'idle' }

const GROUPS: { state: AvailabilityState; note: string }[] = [
  { state: 'available', note: 'Free, and these are hours they asked for.' },
  { state: 'not_preferred', note: 'Free, but they would rather not. You can still choose them.' },
  {
    state: 'unavailable',
    note: 'They said no. You can schedule them anyway — they will see that you did, and it is recorded.',
  },
  {
    state: 'time_off',
    note: 'Approved time off. There is no override here; change the time-off request instead.',
  },
]

/**
 * Everyone who could take a shift, grouped by what they said about the hours.
 *
 * Approved time off is listed rather than hidden, so a manager can see why
 * somebody obvious is missing — and it carries no button, because there is no
 * decision to make. Unavailable does carry one, and pressing it asks once more
 * before it records the override in the manager's name.
 */
export function CandidateList({
  shiftId,
  candidates,
  assignedTo,
  mode,
  roleName,
}: {
  shiftId: string
  candidates: Candidate[]
  assignedTo: string | null
  mode: 'assign' | 'callout'
  roleName: string | null
}) {
  const action = mode === 'callout' ? fillCalloutAction : assignToSlotAction
  const [state, formAction, pending] = useActionState(action, IDLE)
  const [clearState, clearAction, clearing] = useActionState(clearSlotAction, IDLE)
  const [confirming, setConfirming] = useState<string | null>(null)
  // A slot asks for a job, not just a body. People who hold the role fill the
  // groups; everybody else is one tap away, because on a short-staffed night
  // the owner does sometimes run food.
  const qualified = candidates.filter((c) => c.hasJobRole)
  const others = candidates.filter((c) => !c.hasJobRole)
  // When nobody holds the role there is nothing to collapse: the honest answer
  // is "there is one prep cook and this is them", with the rest of the crew
  // already open underneath.
  const [showOthers, setShowOthers] = useState(qualified.length === 0)

  return (
    <div className="flex flex-col gap-5">
      {state.status === 'error' && state.message ? (
        <p
          role="alert"
          className="text-danger rounded-card bg-danger-soft px-4 py-3 text-sm font-medium"
        >
          {state.message}
        </p>
      ) : null}
      {state.status === 'success' && state.message ? (
        <p
          role="status"
          className="text-success rounded-card bg-success-soft px-4 py-3 text-sm font-medium"
        >
          {state.message}
        </p>
      ) : null}

      {GROUPS.map((group) => {
        const people = qualified.filter((c) => c.state === group.state)
        if (people.length === 0) return null
        return (
          <Card key={group.state}>
            <CardHeader
              title={`${AVAILABILITY_LABELS[group.state]} · ${people.length}`}
              description={group.note}
            />
            <ul className="divide-line divide-y">
              {people.map((person) => {
                const isAssigned = person.employmentId === assignedTo
                const needsConfirm = group.state === 'unavailable'
                const asking = confirming === person.employmentId
                return (
                  <li
                    key={person.employmentId}
                    className="flex flex-wrap items-center gap-3 px-5 py-3.5"
                  >
                    <Avatar name={person.displayName} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="text-ink font-medium">{person.displayName}</span>
                        <AvailabilityPill state={person.state} />
                        {isAssigned ? (
                          <span className="text-success text-xs font-semibold">On it now</span>
                        ) : null}
                      </p>
                      <p className="text-muted mt-0.5 text-sm">
                        {person.blocked ? person.blockedReason : person.reason}
                      </p>
                      <p className="text-faint mt-0.5 text-xs tabular-nums">
                        {Math.round(person.weekMinutes / 60)} h this week →{' '}
                        {Math.round(person.wouldBeMinutes / 60)} h
                        {person.overtime ? (
                          <span className="text-warning font-semibold"> · overtime</span>
                        ) : null}
                        {person.hasJobRole ? '' : ' · does not hold this job role'}
                      </p>
                    </div>

                    {group.state === 'time_off' ? (
                      <span className="text-muted text-sm font-medium">Locked</span>
                    ) : isAssigned ? (
                      <form action={clearAction}>
                        <input type="hidden" name="shiftId" value={shiftId} />
                        <Button type="submit" variant="ghost" size="sm" loading={clearing}>
                          Take them off
                        </Button>
                      </form>
                    ) : person.blocked ? (
                      <span className="text-muted text-sm">Not possible</span>
                    ) : needsConfirm && !asking ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => setConfirming(person.employmentId)}
                      >
                        Assign anyway
                      </Button>
                    ) : (
                      <form action={formAction} className="flex items-center gap-2">
                        <input type="hidden" name="shiftId" value={shiftId} />
                        <input type="hidden" name="employmentId" value={person.employmentId} />
                        {needsConfirm ? <input type="hidden" name="override" value="yes" /> : null}
                        <Button
                          type="submit"
                          variant={needsConfirm ? 'danger' : 'primary'}
                          size="sm"
                          loading={pending}
                        >
                          {needsConfirm
                            ? 'Yes, schedule them'
                            : mode === 'callout'
                              ? 'Offer the shift'
                              : 'Assign'}
                        </Button>
                        {needsConfirm ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setConfirming(null)}
                          >
                            Cancel
                          </Button>
                        ) : null}
                      </form>
                    )}
                  </li>
                )
              })}
            </ul>
          </Card>
        )
      })}

      {qualified.length === 0 ? (
        <div className="rounded-card border-line border border-dashed px-5 py-6 text-center">
          <p className="text-ink text-sm font-semibold">
            {roleName
              ? `Nobody else at this location holds the ${roleName.toLowerCase()} role.`
              : 'Nobody else is qualified for this shift.'}
          </p>
          <p className="text-muted mt-1 text-sm">
            You can still put somebody on it — everyone who could take it is below, with what their
            week becomes if they do.
          </p>
        </div>
      ) : null}

      {others.length > 0 ? (
        <Card>
          <CardHeader
            title={
              roleName
                ? `Not ${roleName.toLowerCase()}-qualified · ${others.length}`
                : `Others · ${others.length}`
            }
            description="They do not hold this job role. You can still put them on it."
            action={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowOthers((v) => !v)}
              >
                {showOthers ? 'Hide' : 'Show them'}
              </Button>
            }
          />
          {showOthers ? (
            <ul className="divide-line divide-y">
              {others.map((person) => (
                <li
                  key={person.employmentId}
                  className="flex flex-wrap items-center gap-3 px-5 py-3.5"
                >
                  <Avatar name={person.displayName} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="text-ink font-medium">{person.displayName}</span>
                      <AvailabilityPill state={person.state} />
                    </p>
                    <p className="text-faint mt-0.5 text-xs tabular-nums">
                      {Math.round(person.weekMinutes / 60)} h this week →{' '}
                      {Math.round(person.wouldBeMinutes / 60)} h
                      {person.overtime ? (
                        <span className="text-warning font-semibold"> · overtime</span>
                      ) : null}
                    </p>
                  </div>
                  {person.state === 'time_off' || person.blocked ? (
                    <span className="text-muted text-sm">
                      {person.state === 'time_off' ? 'Locked' : 'Not possible'}
                    </span>
                  ) : (
                    <form action={formAction} className="flex items-center gap-2">
                      <input type="hidden" name="shiftId" value={shiftId} />
                      <input type="hidden" name="employmentId" value={person.employmentId} />
                      {person.state === 'unavailable' ? (
                        <input type="hidden" name="override" value="yes" />
                      ) : null}
                      <Button type="submit" variant="secondary" size="sm" loading={pending}>
                        Assign anyway
                      </Button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}

      {clearState.status === 'error' && clearState.message ? (
        <p role="alert" className="text-danger text-sm font-medium">
          {clearState.message}
        </p>
      ) : null}
    </div>
  )
}
