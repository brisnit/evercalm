'use client'

import { useState } from 'react'
import { cancelSwapAction, requestSwapAction } from '@/modules/scheduling/actions'
import type { MySwap } from '@/modules/scheduling/employee'
import { ActionForm } from '@/ui/patterns/action-form'
import { ActionNotice, useActionNotice } from '@/ui/patterns/action-notice'
import { Card, CardHeader, Field, Input } from '@/ui/primitives'

const SELECT =
  'rounded-control border-line-strong text-ink min-h-11 w-full border bg-white px-3 text-sm focus:border-violet-600'

/**
 * Giving away or trading a shift. Always a named colleague who agrees first,
 * then a manager who confirms - so nobody finds a shift on their schedule
 * they did not agree to.
 */
export function SwapPanel({
  shiftId,
  started,
  swap,
  colleagues,
}: {
  shiftId: string
  started: boolean
  swap: MySwap | null
  colleagues: {
    employmentId: string
    displayName: string
    shifts: { id: string; label: string }[]
  }[]
}) {
  const { notice, show, dismiss } = useActionNotice()
  const [kind, setKind] = useState<'giveaway' | 'trade'>('giveaway')
  const [recipient, setRecipient] = useState('')
  const theirShifts = colleagues.find((c) => c.employmentId === recipient)?.shifts ?? []

  return (
    <div className="mt-5 flex flex-col gap-4">
      <ActionNotice notice={notice} onDismiss={dismiss} />

      {swap ? (
        <Card className="p-5">
          <p className="text-ink font-medium">
            {swap.direction === 'outgoing'
              ? `You asked ${swap.otherName} to ${swap.kind === 'trade' ? 'trade' : 'take this shift'}.`
              : `${swap.otherName} asked you about this shift.`}
          </p>
          <p className="text-muted mt-1 text-sm">
            {swap.status === 'pending_recipient'
              ? `Waiting for ${swap.otherName} to answer.`
              : 'They agreed. Waiting for a manager to confirm.'}
          </p>
          {swap.direction === 'outgoing' ? (
            <ActionForm
              action={cancelSwapAction}
              submitLabel="Withdraw request"
              variant="secondary"
              className="mt-3 flex"
              onSuccess={show}
            >
              <input type="hidden" name="requestId" value={swap.id} />
            </ActionForm>
          ) : null}
        </Card>
      ) : started ? (
        <p className="text-muted text-sm">
          This shift has started, so it can no longer be swapped.
        </p>
      ) : colleagues.length === 0 ? (
        <p className="text-muted text-sm">Nobody else works at this location to swap with.</p>
      ) : (
        <Card>
          <CardHeader
            title="Can’t work it?"
            description="Ask a colleague. They agree first, then a manager confirms."
          />
          <div className="p-5">
            <ActionForm action={requestSwapAction} submitLabel="Send request" onSuccess={show}>
              {(state) => (
                <>
                  <input type="hidden" name="shiftId" value={shiftId} />
                  <fieldset className="border-0 p-0">
                    <legend className="text-ink text-sm font-medium">What would you like?</legend>
                    <div className="mt-2 flex flex-col gap-2">
                      <label className="border-line-strong rounded-control flex min-h-11 items-center gap-2.5 border bg-white px-3 text-sm">
                        <input
                          type="radio"
                          name="kind"
                          value="giveaway"
                          checked={kind === 'giveaway'}
                          onChange={() => setKind('giveaway')}
                          className="h-4 w-4"
                        />
                        Someone takes this shift
                      </label>
                      <label className="border-line-strong rounded-control flex min-h-11 items-center gap-2.5 border bg-white px-3 text-sm">
                        <input
                          type="radio"
                          name="kind"
                          value="trade"
                          checked={kind === 'trade'}
                          onChange={() => setKind('trade')}
                          className="h-4 w-4"
                        />
                        Trade for one of their shifts
                      </label>
                    </div>
                  </fieldset>

                  <Field
                    id="swap-recipient"
                    label="Colleague"
                    required
                    error={state.fieldErrors?.recipientEmploymentId?.[0]}
                  >
                    {(p) => (
                      <select
                        {...p}
                        name="recipientEmploymentId"
                        required
                        value={recipient}
                        onChange={(e) => setRecipient(e.target.value)}
                        className={SELECT}
                      >
                        <option value="">Choose a colleague</option>
                        {colleagues.map((c) => (
                          <option key={c.employmentId} value={c.employmentId}>
                            {c.displayName}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>

                  {kind === 'trade' ? (
                    <Field
                      id="swap-their-shift"
                      label="Their shift you would take"
                      required
                      hint={
                        recipient && theirShifts.length === 0
                          ? 'They have no upcoming published shifts to trade.'
                          : undefined
                      }
                      error={state.fieldErrors?.recipientShiftId?.[0]}
                    >
                      {(p) => (
                        <select
                          {...p}
                          name="recipientShiftId"
                          required
                          defaultValue=""
                          className={SELECT}
                          disabled={!recipient || theirShifts.length === 0}
                        >
                          <option value="">Choose a shift</option>
                          {theirShifts.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </Field>
                  ) : null}

                  <Field id="swap-note" label="Message (optional)">
                    {(p) => (
                      <Input
                        {...p}
                        name="note"
                        maxLength={500}
                        placeholder="e.g. Exam that evening"
                      />
                    )}
                  </Field>
                </>
              )}
            </ActionForm>
          </div>
        </Card>
      )}
    </div>
  )
}
