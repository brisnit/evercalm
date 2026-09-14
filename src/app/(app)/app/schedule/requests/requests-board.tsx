'use client'

import Link from 'next/link'
import {
  decideClaimAction,
  decideSwapAction,
  decideTimeOffAction,
} from '@/modules/scheduling/actions'
import { ActionNotice, useActionNotice } from '@/ui/patterns/action-notice'
import { Badge, Card, CardHeader, EmptyState } from '@/ui/primitives'
import { DecisionForm } from '../_components/decision-form'

export interface TimeOffItem {
  id: string
  displayName: string
  period: string
  reason: string
  note: string
  status: string
  decidedByName: string | null
  decisionNote: string
  affectedShifts: { id: string; label: string; locationName: string }[]
}

export interface ClaimItem {
  id: string
  displayName: string
  shiftId: string
  shiftLabel: string
  locationName: string
  jobRoleName: string | null
  note: string
  conflicts: { severity: string; message: string }[]
}

export interface SwapItem {
  id: string
  kind: string
  status: string
  locationName: string
  requesterName: string
  recipientName: string
  shiftLabel: string
  recipientShiftLabel: string | null
  note: string
  conflicts: string[]
  stale: boolean
  decidedByName: string | null
  decisionNote: string
}

const STATUS: Record<
  string,
  { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info' }
> = {
  pending: { label: 'Waiting for you', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  denied: { label: 'Denied', tone: 'danger' },
  cancelled: { label: 'Withdrawn', tone: 'neutral' },
  pending_manager: { label: 'Waiting for you', tone: 'warning' },
  pending_recipient: { label: 'Waiting for the colleague', tone: 'info' },
  declined: { label: 'Colleague declined', tone: 'neutral' },
  expired: { label: 'Did not go ahead', tone: 'neutral' },
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, tone: 'neutral' as const }
  return <Badge tone={s.tone}>{s.label}</Badge>
}

export function RequestsBoard({
  timeOff,
  claims,
  swaps,
}: {
  timeOff: TimeOffItem[] | null
  claims: ClaimItem[] | null
  swaps: SwapItem[] | null
}) {
  const { notice, show, dismiss } = useActionNotice()
  const pendingTimeOff = timeOff?.filter((r) => r.status === 'pending') ?? []
  const decidedTimeOff =
    timeOff?.filter((r) => r.status === 'approved' || r.status === 'denied').slice(0, 8) ?? []
  const swapsForMe = swaps?.filter((s) => s.status === 'pending_manager') ?? []
  const swapsWaiting = swaps?.filter((s) => s.status === 'pending_recipient') ?? []

  return (
    <div className="flex flex-col gap-6">
      <ActionNotice notice={notice} onDismiss={dismiss} />

      {timeOff ? (
        <Card as="section">
          <CardHeader
            title="Time off"
            description={
              pendingTimeOff.length === 0
                ? 'Nothing waiting.'
                : `${pendingTimeOff.length} waiting for a decision.`
            }
          />
          {pendingTimeOff.length === 0 ? null : (
            <ul className="divide-line divide-y">
              {pendingTimeOff.map((r) => (
                <li key={r.id} className="grid gap-4 px-5 py-4 md:grid-cols-[minmax(0,1fr)_20rem]">
                  <div className="min-w-0">
                    <p className="text-ink font-medium">{r.displayName}</p>
                    <p className="text-ink text-sm">{r.period}</p>
                    <p className="text-muted text-sm">
                      {r.reason}
                      {r.note ? ` · “${r.note}”` : ''}
                    </p>
                    {r.affectedShifts.length > 0 ? (
                      <div className="rounded-control border-warning/30 bg-warning-soft mt-2 border px-3 py-2 text-sm">
                        <p className="text-ink font-medium">
                          Already on {r.affectedShifts.length}{' '}
                          {r.affectedShifts.length === 1 ? 'shift' : 'shifts'} in this time
                        </p>
                        <ul className="text-muted mt-1 text-xs">
                          {r.affectedShifts.map((s) => (
                            <li key={s.id}>
                              <Link
                                href={`/app/schedule/shifts/${s.id}`}
                                className="underline underline-offset-4"
                              >
                                {s.label}
                              </Link>{' '}
                              · {s.locationName}
                            </li>
                          ))}
                        </ul>
                        <p className="text-muted mt-1 text-xs">
                          Approving does not move them. Reassign or open those shifts afterwards.
                        </p>
                      </div>
                    ) : null}
                  </div>
                  <DecisionForm
                    idPrefix={`timeoff-${r.id}`}
                    action={decideTimeOffAction}
                    hidden={{ requestId: r.id }}
                    approve={{ value: 'approved', label: 'Approve' }}
                    reject={{ value: 'denied', label: 'Deny' }}
                    noteLabel="Note to them (optional)"
                    onSuccess={show}
                  />
                </li>
              ))}
            </ul>
          )}
          {decidedTimeOff.length > 0 ? (
            <div className="border-line border-t px-5 py-4">
              <h3 className="text-faint text-[0.6875rem] font-semibold tracking-wide uppercase">
                Recently decided
              </h3>
              <ul className="mt-2 flex flex-col gap-2 text-sm">
                {decidedTimeOff.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <StatusBadge status={r.status} />
                    <span className="text-ink">{r.displayName}</span>
                    <span className="text-muted">
                      {r.period}
                      {r.decidedByName ? ` · by ${r.decidedByName}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      ) : null}

      {claims ? (
        <Card as="section">
          <CardHeader
            title="Open shift requests"
            description={
              claims.length === 0
                ? 'Nobody is waiting on an open shift.'
                : 'Give the shift to one person; everyone else who asked is told.'
            }
          />
          {claims.length > 0 ? (
            <ul className="divide-line divide-y">
              {claims.map((c) => {
                const blocked = c.conflicts.find((x) => x.severity === 'block')
                return (
                  <li
                    key={c.id}
                    className="grid gap-4 px-5 py-4 md:grid-cols-[minmax(0,1fr)_20rem]"
                  >
                    <div className="min-w-0">
                      <p className="text-ink font-medium">{c.displayName}</p>
                      <p className="text-sm">
                        <Link
                          href={`/app/schedule/shifts/${c.shiftId}`}
                          className="text-ink underline underline-offset-4"
                        >
                          {c.shiftLabel}
                        </Link>
                        <span className="text-muted">
                          {' '}
                          · {c.locationName}
                          {c.jobRoleName ? ` · ${c.jobRoleName}` : ''}
                        </span>
                      </p>
                      {c.note ? <p className="text-muted text-sm">“{c.note}”</p> : null}
                      {c.conflicts.length > 0 ? (
                        <ul className="mt-1 flex flex-col gap-0.5">
                          {c.conflicts.map((x) => (
                            <li
                              key={x.message}
                              className={
                                x.severity === 'block'
                                  ? 'text-danger text-xs'
                                  : 'text-warning text-xs'
                              }
                            >
                              {x.message}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                    {blocked ? (
                      <DecisionForm
                        idPrefix={`claim-${c.id}`}
                        action={decideClaimAction}
                        hidden={{ claimId: c.id }}
                        approve={{ value: 'declined', label: 'Decline' }}
                        noteLabel="They cannot take it. Note to them (optional)"
                        onSuccess={show}
                      />
                    ) : (
                      <DecisionForm
                        idPrefix={`claim-${c.id}`}
                        action={decideClaimAction}
                        hidden={{ claimId: c.id }}
                        approve={{ value: 'approved', label: 'Give it to them' }}
                        reject={{ value: 'declined', label: 'Decline' }}
                        noteLabel="Note to them (optional)"
                        onSuccess={show}
                      />
                    )}
                  </li>
                )
              })}
            </ul>
          ) : null}
        </Card>
      ) : null}

      {swaps ? (
        <Card as="section">
          <CardHeader
            title="Shift swaps"
            description={
              swapsForMe.length === 0
                ? 'No swaps waiting for you.'
                : 'Both colleagues have agreed. Approving moves the shifts and tells them both.'
            }
          />
          {swapsForMe.length > 0 ? (
            <ul className="divide-line divide-y">
              {swapsForMe.map((s) => (
                <li key={s.id} className="grid gap-4 px-5 py-4 md:grid-cols-[minmax(0,1fr)_20rem]">
                  <div className="min-w-0">
                    <p className="text-ink font-medium">
                      {s.kind === 'trade'
                        ? `${s.requesterName} and ${s.recipientName} want to trade`
                        : `${s.recipientName} would take ${s.requesterName}’s shift`}
                    </p>
                    <p className="text-ink text-sm">
                      {s.shiftLabel}
                      {s.recipientShiftLabel ? ` ⇄ ${s.recipientShiftLabel}` : ''}
                      <span className="text-muted"> · {s.locationName}</span>
                    </p>
                    {s.note ? <p className="text-muted text-sm">“{s.note}”</p> : null}
                    {s.stale ? (
                      <p className="text-warning mt-1 text-xs font-medium">
                        The shift has changed or started since they agreed. Approving will not apply
                        it.
                      </p>
                    ) : null}
                    {s.conflicts.length > 0 ? (
                      <ul className="text-warning mt-1 flex flex-col gap-0.5 text-xs">
                        {s.conflicts.map((m) => (
                          <li key={m}>{m}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  <DecisionForm
                    idPrefix={`swap-${s.id}`}
                    action={decideSwapAction}
                    hidden={{ requestId: s.id }}
                    approve={{ value: 'approved', label: 'Approve swap' }}
                    reject={{ value: 'denied', label: 'Deny' }}
                    noteLabel="Note to both (optional)"
                    onSuccess={show}
                  />
                </li>
              ))}
            </ul>
          ) : null}
          {swapsWaiting.length > 0 ? (
            <div className="border-line border-t px-5 py-4">
              <h3 className="text-faint text-[0.6875rem] font-semibold tracking-wide uppercase">
                Waiting for the colleague
              </h3>
              <ul className="mt-2 flex flex-col gap-1.5 text-sm">
                {swapsWaiting.map((s) => (
                  <li key={s.id} className="text-muted">
                    <span className="text-ink">{s.requesterName}</span> asked {s.recipientName} ·{' '}
                    {s.shiftLabel}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      ) : null}

      {timeOff && claims === null && swaps === null && pendingTimeOff.length === 0 ? (
        <EmptyState
          title="All caught up"
          description="New time-off requests appear here as people send them."
        />
      ) : null}
    </div>
  )
}
