'use client'

import { useActionState, useEffect, useRef } from 'react'
import { Button, Textarea } from '@/ui/primitives'
import type { ActionState } from '@/modules/messaging/actions'

const IDLE: ActionState = { status: 'idle' }

/**
 * The box you type a message into.
 *
 * It clears itself once the message is away and puts the cursor back, because
 * the next thing a person does after sending a message is usually send
 * another. Enter with a modifier sends, so a thumb on a phone can use the
 * button and a keyboard need not reach for the mouse.
 */
export function MessageComposer({
  action,
  hidden,
  placeholder,
  label,
}: {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>
  hidden: Record<string, string>
  placeholder: string
  label: string
}) {
  const form = useRef<HTMLFormElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const [state, formAction, pending] = useActionState(action, IDLE)

  useEffect(() => {
    if (state.status === 'success') {
      form.current?.reset()
      box.current?.focus()
    }
  }, [state])

  return (
    <form ref={form} action={formAction} className="flex flex-col gap-2">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <label htmlFor="message-body" className="sr-only">
        {label}
      </label>
      <Textarea
        ref={box}
        id="message-body"
        name="body"
        rows={2}
        placeholder={placeholder}
        className="min-h-[3.25rem]"
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            form.current?.requestSubmit()
          }
        }}
      />
      {state.status === 'error' && state.message ? (
        <p role="alert" className="text-danger text-sm font-medium">
          {state.message}
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <p className="text-faint hidden text-xs sm:block">⌘ + Enter sends</p>
        <Button type="submit" loading={pending} className="ms-auto">
          Send
        </Button>
      </div>
    </form>
  )
}
