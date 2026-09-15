'use client'

import { useState } from 'react'
import { cancelTimeOffAction, requestTimeOffAction } from '@/modules/scheduling/actions'
import { ActionForm } from '@/ui/patterns/action-form'
import { ActionNotice, useActionNotice } from '@/ui/patterns/action-notice'
import { ConfirmAction } from '@/ui/patterns/confirm-action'
import { Badge, Card, CardHeader, Field, Input, Select } from '@/ui/primitives'

const STATUS: Record<
  string,
  { label: string; tone: 'warning' | 'success' | 'danger' | 'neutral' }
> = {
  pending: { label: 'Waiting for a decision', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  denied: { label: 'Not approved', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
}

export function TimeOffPanel({
  today,
  requests,
}: {
  today: string
  requests: {
    id: string
    period: string
    reason: string
    note: string
    status: string
    decidedByName: string | null
    decisionNote: string
    cancellable: boolean
  }[]
}) {
  const { notice, show, dismiss } = useActionNotice()
  const [partOfDay, setPartOfDay] = useState(false)
  const [startsOn, setStartsOn] = useState(today)

  return (
    <div className="mt-6 flex flex-col gap-5">
      <ActionNotice notice={notice} onDismiss={dismiss} />

      <Card>
        <CardHeader title="Ask for time off" />
        <div className="p-5">
          <ActionForm action={requestTimeOffAction} submitLabel="Send request" onSuccess={show}>
            {(state) => (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    id="to-start"
                    label="First day"
                    required
                    error={state.fieldErrors?.startsOn?.[0]}
                  >
                    {(p) => (
                      <Input
                        {...p}
                        type="date"
                        name="startsOn"
                        required
                        min={today}
                        value={startsOn}
                        onChange={(e) => setStartsOn(e.target.value)}
                      />
                    )}
                  </Field>
                  <Field id="to-end" label="Last day" error={state.fieldErrors?.endsOn?.[0]}>
                    {(p) => (
                      <Input
                        {...p}
                        type="date"
                        name="endsOn"
                        min={startsOn || today}
                        disabled={partOfDay}
                      />
                    )}
                  </Field>
                </div>

                <label className="flex items-start gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    name="partOfDay"
                    checked={partOfDay}
                    onChange={(e) => setPartOfDay(e.target.checked)}
                    className="mt-0.5 h-4 w-4"
                  />
                  <span className="text-ink">Only part of the day</span>
                </label>

                {partOfDay ? (
                  <div className="grid grid-cols-2 gap-3">
                    <Field id="to-from" label="From" required>
                      {(p) => (
                        <Input {...p} type="time" name="startTime" required defaultValue="09:00" />
                      )}
                    </Field>
                    <Field
                      id="to-until"
                      label="Until"
                      required
                      error={state.fieldErrors?.endTime?.[0]}
                    >
                      {(p) => (
                        <Input {...p} type="time" name="endTime" required defaultValue="13:00" />
                      )}
                    </Field>
                  </div>
                ) : null}

                <Field
                  id="to-reason"
                  label="Reason"
                  required
                  error={state.fieldErrors?.reason?.[0]}
                >
                  {(p) => (
                    <Select {...p} name="reason" required defaultValue="personal">
                      <option value="vacation">Vacation</option>
                      <option value="sick">Sick</option>
                      <option value="personal">Personal</option>
                      <option value="family">Family</option>
                      <option value="other">Other</option>
                    </Select>
                  )}
                </Field>
                <Field id="to-note" label="Note for your manager (optional)">
                  {(p) => <Input {...p} name="note" maxLength={500} />}
                </Field>
              </>
            )}
          </ActionForm>
        </div>
      </Card>

      <section aria-labelledby="requests-heading">
        <h2 id="requests-heading" className="font-display text-ink text-lg font-bold">
          Your requests
        </h2>
        {requests.length === 0 ? (
          <p className="text-muted mt-2 text-sm">You have not asked for any time off.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {requests.map((r) => {
              const status = STATUS[r.status] ?? { label: r.status, tone: 'neutral' as const }
              return (
                <li key={r.id}>
                  <Card className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-ink font-medium">{r.period}</p>
                        <p className="text-muted text-sm">
                          {r.reason}
                          {r.note ? ` · ${r.note}` : ''}
                        </p>
                      </div>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </div>
                    {r.decisionNote || r.decidedByName ? (
                      <p className="text-muted mt-2 text-sm">
                        {r.decidedByName ? `${r.decidedByName}: ` : ''}
                        {r.decisionNote ||
                          (r.status === 'approved' ? 'Approved.' : 'Not approved.')}
                      </p>
                    ) : null}
                    {r.cancellable ? (
                      <div className="mt-3">
                        <ConfirmAction
                          triggerLabel="Cancel request"
                          title="Cancel this request?"
                          description={
                            r.status === 'approved'
                              ? 'Your time off is removed and you can be scheduled for these dates again.'
                              : 'The request is withdrawn before anyone decides it.'
                          }
                        >
                          <ActionForm
                            action={cancelTimeOffAction}
                            submitLabel="Yes, cancel it"
                            destructive
                            onSuccess={show}
                          >
                            <input type="hidden" name="requestId" value={r.id} />
                          </ActionForm>
                        </ConfirmAction>
                      </div>
                    ) : null}
                  </Card>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
