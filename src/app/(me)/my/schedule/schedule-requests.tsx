'use client'

import Link from 'next/link'
import {
  cancelSwapAction,
  claimOpenShiftAction,
  respondToSwapAction,
  withdrawClaimAction,
} from '@/modules/scheduling/actions'
import type { MySwap, OpenShift } from '@/modules/scheduling/employee'
import { ActionForm } from '@/ui/patterns/action-form'
import { ActionNotice, useActionNotice } from '@/ui/patterns/action-notice'
import { Badge, Card } from '@/ui/primitives'

const SWAP_STATUS: Record<
  string,
  { label: string; tone: 'warning' | 'info' | 'success' | 'neutral' | 'danger' }
> = {
  pending_recipient: { label: 'Waiting for your colleague', tone: 'info' },
  pending_manager: { label: 'Waiting for a manager', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  declined: { label: 'Declined', tone: 'neutral' },
  denied: { label: 'Not approved', tone: 'danger' },
  expired: { label: 'Did not go ahead', tone: 'neutral' },
}

const CLAIM_STATUS: Record<string, { label: string; tone: 'warning' | 'success' | 'neutral' }> = {
  pending: { label: 'Waiting for a manager', tone: 'warning' },
  approved: { label: 'It’s yours', tone: 'success' },
  declined: { label: 'Went to someone else', tone: 'neutral' },
  expired: { label: 'No longer offered', tone: 'neutral' },
}

/**
 * A colleague asking you to take (or trade) a shift. Answering removes it from here.
 *
 * Rendered even when there is nothing to answer, so the confirmation of the
 * LAST answer survives: the section disappears with the refresh, and a notice
 * held inside it used to disappear with it (see action-notice.tsx).
 */
export function IncomingSwaps({ swaps }: { swaps: MySwap[] }) {
  const { notice, show, dismiss } = useActionNotice()
  return (
    <>
      <ActionNotice notice={notice} onDismiss={dismiss} />
      {swaps.length > 0 ? (
        <section aria-labelledby="needs-you-heading" className="flex flex-col gap-3">
          <h2 id="needs-you-heading" className="font-display text-ink text-lg font-bold">
            Needs you
          </h2>
          {swaps.map((swap) => (
            <Card key={swap.id} className="border-violet-200 p-4">
              <p className="text-ink font-medium">
                {swap.kind === 'trade'
                  ? `${swap.otherName} wants to trade shifts with you`
                  : `${swap.otherName} asked you to take their shift`}
              </p>
              <p className="text-ink mt-1 text-sm">
                {swap.kind === 'trade' ? 'You would work: ' : ''}
                <span className="font-semibold">{swap.shiftLabel}</span>
              </p>
              {swap.recipientShiftLabel ? (
                <p className="text-muted text-sm">
                  They would work your {swap.recipientShiftLabel}
                </p>
              ) : null}
              {swap.note ? <p className="text-muted mt-1 text-sm">“{swap.note}”</p> : null}
              <p className="text-faint mt-2 text-xs">If you agree, a manager still confirms it.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <ActionForm
                  action={respondToSwapAction}
                  submitLabel="I’ll take it"
                  className="flex"
                  onSuccess={show}
                >
                  <input type="hidden" name="requestId" value={swap.id} />
                  <input type="hidden" name="accept" value="true" />
                </ActionForm>
                <ActionForm
                  action={respondToSwapAction}
                  submitLabel="I can’t"
                  variant="secondary"
                  className="flex"
                  onSuccess={show}
                >
                  <input type="hidden" name="requestId" value={swap.id} />
                  <input type="hidden" name="accept" value="false" />
                </ActionForm>
              </div>
            </Card>
          ))}
        </section>
      ) : null}
    </>
  )
}

export function OpenShiftsAndRequests({
  openShifts,
  swaps,
  claims,
  timeOff,
}: {
  openShifts: OpenShift[]
  swaps: MySwap[]
  claims: {
    id: string
    status: string
    shiftLabel: string
    locationName: string
    decisionNote: string
  }[]
  timeOff: { pending: number; approvedUpcoming: number }
}) {
  const { notice, show, dismiss } = useActionNotice()
  return (
    <>
      <ActionNotice notice={notice} onDismiss={dismiss} />

      <section id="open-shifts" aria-labelledby="open-heading" className="scroll-mt-6">
        <h2 id="open-heading" className="font-display text-ink text-lg font-bold">
          Open shifts
        </h2>
        {openShifts.length === 0 ? (
          <p className="text-muted mt-2 text-sm">No open shifts at your locations right now.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {openShifts.map((shift) => (
              <li key={shift.id}>
                <Card className="p-4">
                  <p className="text-ink font-semibold tabular-nums">
                    {shift.day} · {shift.time}
                    {shift.endsNextDay ? ' (next day)' : ''}
                  </p>
                  <p className="text-muted text-sm">
                    {[shift.jobRoleName, shift.stationName].filter(Boolean).join(' · ') || 'Shift'}{' '}
                    · {shift.locationName} · {shift.duration}
                  </p>
                  {shift.myClaim?.status === 'pending' ? (
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <Badge tone="warning">You asked · waiting for a manager</Badge>
                      <ActionForm
                        action={withdrawClaimAction}
                        submitLabel="Withdraw"
                        variant="ghost"
                        className="flex"
                        onSuccess={show}
                      >
                        <input type="hidden" name="claimId" value={shift.myClaim.id} />
                      </ActionForm>
                    </div>
                  ) : shift.myClaim?.status === 'declined' ? (
                    <p className="text-muted mt-2 text-sm">A manager gave this to someone else.</p>
                  ) : shift.blockedReason ? (
                    <p className="text-muted mt-2 text-sm">
                      You can’t take this: {shift.blockedReason}
                    </p>
                  ) : (
                    <div className="mt-3">
                      {shift.warnings.length > 0 ? (
                        <p className="text-warning mb-2 text-xs">{shift.warnings.join(' ')}</p>
                      ) : null}
                      <ActionForm
                        action={claimOpenShiftAction}
                        submitLabel="Ask for this shift"
                        variant="secondary"
                        onSuccess={show}
                      >
                        <input type="hidden" name="shiftId" value={shift.id} />
                      </ActionForm>
                    </div>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="swaps" aria-labelledby="requests-heading" className="scroll-mt-6">
        <h2 id="requests-heading" className="font-display text-ink text-lg font-bold">
          Your requests
        </h2>
        {swaps.length === 0 && claims.length === 0 ? (
          <p className="text-muted mt-2 text-sm">
            Ask to give away or trade a shift from the shift itself.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {swaps.map((swap) => {
              const status = SWAP_STATUS[swap.status] ?? {
                label: swap.status,
                tone: 'neutral' as const,
              }
              const open = swap.status === 'pending_recipient' || swap.status === 'pending_manager'
              return (
                <li key={swap.id}>
                  <Card className="p-4">
                    <Badge tone={status.tone}>{status.label}</Badge>
                    <p className="text-ink mt-2 text-sm">
                      {swap.direction === 'outgoing'
                        ? swap.kind === 'trade'
                          ? `Trade with ${swap.otherName}: your ${swap.shiftLabel}`
                          : `${swap.otherName} to take your ${swap.shiftLabel}`
                        : `${swap.otherName}’s ${swap.shiftLabel}`}
                    </p>
                    {swap.decisionNote ? (
                      <p className="text-muted text-sm">{swap.decisionNote}</p>
                    ) : null}
                    {open && swap.direction === 'outgoing' ? (
                      <ActionForm
                        action={cancelSwapAction}
                        submitLabel="Withdraw request"
                        variant="ghost"
                        className="mt-2 flex"
                        onSuccess={show}
                      >
                        <input type="hidden" name="requestId" value={swap.id} />
                      </ActionForm>
                    ) : null}
                  </Card>
                </li>
              )
            })}
            {claims.map((claim) => {
              const status = CLAIM_STATUS[claim.status] ?? {
                label: claim.status,
                tone: 'neutral' as const,
              }
              return (
                <li key={claim.id}>
                  <Card className="p-4">
                    <Badge tone={status.tone}>{status.label}</Badge>
                    <p className="text-ink mt-2 text-sm">
                      Open shift {claim.shiftLabel} · {claim.locationName}
                    </p>
                    {claim.decisionNote ? (
                      <p className="text-muted text-sm">{claim.decisionNote}</p>
                    ) : null}
                  </Card>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <p className="text-muted text-sm">
        <Link href="/my/time-off" className="text-violet-700 underline underline-offset-4">
          Time off
        </Link>
        {timeOff.pending > 0 ? ` · ${timeOff.pending} waiting for a decision` : ''}
        {timeOff.approvedUpcoming > 0 ? ` · ${timeOff.approvedUpcoming} approved` : ''}
      </p>
    </>
  )
}
