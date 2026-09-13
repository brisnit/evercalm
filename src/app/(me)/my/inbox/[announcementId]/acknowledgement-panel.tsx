'use client'

import { acknowledgeAction } from '@/modules/comms/actions'
import { ActionForm } from '@/ui/patterns/action-form'
import { ActionNotice, useActionNotice } from '@/ui/patterns/action-notice'
import { Card } from '@/ui/primitives'

/**
 * The acknowledgement control, and what happens after it.
 *
 * A single, deliberate press. There is no "acknowledge on scroll", no timer,
 * and no automatic confirmation on open - the record has to mean that a person
 * chose to make it.
 *
 * The panel stays mounted when the page refreshes after the press, so the
 * thank-you stays on screen above "You confirmed this" instead of vanishing
 * with the button. It is not stored anywhere: reloading or coming back later
 * shows only the recorded state.
 */
export function AcknowledgementPanel({
  announcementId,
  needsAck,
  overdue,
  dueLabel,
  recordedLabel,
}: {
  announcementId: string
  needsAck: boolean
  overdue: boolean
  dueLabel: string | null
  recordedLabel: string
}) {
  const { notice, show, dismiss } = useActionNotice()

  return (
    <Card
      className={needsAck && overdue ? 'border-warning/50 mt-5 p-5' : 'mt-5 border-violet-200 p-5'}
    >
      <ActionNotice notice={notice} onDismiss={dismiss} className="mb-4" />

      <h2 className="font-display text-ink text-base font-bold">
        {needsAck ? 'Confirm you have read this' : 'You confirmed this'}
      </h2>

      {needsAck ? (
        <>
          <p className="text-muted mt-1.5 text-sm">
            Your manager can see who has confirmed and who has not.
            {dueLabel ? ` Due ${dueLabel}.` : ''}
          </p>
          {overdue ? (
            <p className="text-warning mt-1.5 text-sm font-semibold">This is past its due date.</p>
          ) : null}
          <div className="mt-4">
            <ActionForm action={acknowledgeAction} submitLabel="I have read this" onSuccess={show}>
              <input type="hidden" name="announcementId" value={announcementId} />
            </ActionForm>
          </div>
        </>
      ) : (
        <p className="text-muted mt-1.5 text-sm">{recordedLabel}</p>
      )}
    </Card>
  )
}
