'use client'

import { useActionState, useState } from 'react'
import {
  blockStepAction,
  completeStepAction,
  type OnboardingActionState,
} from '@/modules/onboarding/actions'
import { Button, Input } from '@/ui/primitives'

const INITIAL: OnboardingActionState = { status: 'idle' }

/**
 * Mark a step done, or say what is stopping you.
 *
 * Both are 44px touch targets, because this is used on a phone between other
 * things rather than at a desk.
 */
export function StepActions({ stepProgressId }: { stepProgressId: string }) {
  const [completeState, completeAction, completing] = useActionState(completeStepAction, INITIAL)
  const [blockState, blockAction, blocking] = useActionState(blockStepAction, INITIAL)
  const [showBlock, setShowBlock] = useState(false)

  const message = completeState.message ?? blockState.message
  const failed = completeState.status === 'error' || blockState.status === 'error'

  return (
    <div className="flex flex-col gap-2">
      {message ? (
        <p
          role="status"
          className={failed ? 'text-danger text-sm font-medium' : 'text-success text-sm'}
        >
          {message}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <form action={completeAction}>
          <input type="hidden" name="stepProgressId" value={stepProgressId} />
          <Button type="submit" variant="secondary" loading={completing}>
            Mark done
          </Button>
        </form>
        {!showBlock ? (
          <Button variant="ghost" onClick={() => setShowBlock(true)}>
            I&rsquo;m stuck
          </Button>
        ) : null}
      </div>

      {showBlock ? (
        <form action={blockAction} className="border-line flex flex-col gap-2 border-t pt-3">
          <input type="hidden" name="stepProgressId" value={stepProgressId} />
          <label htmlFor={`reason-${stepProgressId}`} className="text-ink text-sm font-medium">
            What is stopping you?
          </label>
          <Input
            id={`reason-${stepProgressId}`}
            name="reason"
            required
            maxLength={300}
            placeholder="e.g. waiting on my food handler card"
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="secondary" loading={blocking}>
              Let my manager know
            </Button>
            <Button variant="ghost" onClick={() => setShowBlock(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  )
}
