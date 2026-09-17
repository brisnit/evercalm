'use client'

import { useState } from 'react'
import { SIGN_OUT_FAILED } from '@/lib/auth-messages'
import { signOutAndLeave } from '@/lib/sign-out'
import { Button } from '@/ui/primitives'

/**
 * Sign out of the administration and EverCalm team consoles. Before, a failed
 * sign-out left the button spinning, or moved to a sign-in page that sent the
 * still-signed-in person straight back; now it says what happened.
 */
export function SignOutButton() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <span className="inline-flex flex-col items-end">
      <Button
        variant="ghost"
        size="sm"
        loading={busy}
        onClick={() => {
          setBusy(true)
          setError(null)
          signOutAndLeave().catch(() => {
            setBusy(false)
            setError(SIGN_OUT_FAILED)
          })
        }}
      >
        Sign out
      </Button>
      {error ? (
        <span role="alert" className="text-danger max-w-56 text-right text-xs font-medium">
          {error}
        </span>
      ) : null}
    </span>
  )
}
