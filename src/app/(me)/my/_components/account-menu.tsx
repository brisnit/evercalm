'use client'

import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'
import { SIGN_OUT_FAILED } from '@/lib/auth-messages'
import { signOutAndLeave } from '@/lib/sign-out'
import { Avatar, Button } from '@/ui/primitives'

/**
 * The employee's account control: who is signed in, and a way out.
 *
 * A disclosure, not an ARIA menu: a button with aria-expanded that shows a
 * small panel of ordinary links and buttons, reached with Tab like the rest of
 * the page. Escape, a click elsewhere, or tabbing away closes it; Escape puts
 * focus back on the button.
 *
 * Signing out ends the session on the server, then loads the sign-in page
 * fresh, so nothing of the previous person survives in the client.
 */
export function AccountMenu({
  name,
  organizationName,
}: {
  name: string
  organizationName: string
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const panelId = useId()
  const container = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const firstName = name.split(' ')[0] ?? name

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  async function signOutNow() {
    setBusy(true)
    setError(null)
    try {
      await signOutAndLeave()
    } catch {
      setBusy(false)
      setError(SIGN_OUT_FAILED)
    }
  }

  return (
    <div
      ref={container}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation()
          setOpen(false)
          button.current?.focus()
        }
      }}
      onBlur={(event) => {
        // Only a real move of focus elsewhere closes it. Safari does not focus
        // a tapped button, so a tap inside blurs with no related target; that
        // must not close the panel before the tap lands. Taps outside are
        // handled by the pointerdown listener.
        const next = event.relatedTarget
        if (next instanceof Node && !container.current?.contains(next)) setOpen(false)
      }}
    >
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Account: ${name}`}
        onClick={() => setOpen((value) => !value)}
        className="rounded-control text-ink hover:bg-sunk flex min-h-11 items-center gap-2 px-1.5 text-sm font-medium focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:outline-none"
      >
        <Avatar name={name} size="sm" />
        <span className="max-w-[7rem] truncate">{firstName}</span>
        <span aria-hidden="true" className="text-faint text-xs">
          ▾
        </span>
      </button>

      <div
        id={panelId}
        hidden={!open}
        className="rounded-card border-line shadow-lift absolute top-full right-0 z-30 mt-2 w-64 max-w-[calc(100vw-2.5rem)] border bg-white p-2"
      >
        <div className="border-line border-b px-3 pt-2 pb-3">
          <p className="text-ink truncate text-sm font-semibold">{name}</p>
          <p className="text-muted truncate text-xs">{organizationName}</p>
        </div>
        <Link
          href="/my/notifications"
          onClick={() => setOpen(false)}
          className="rounded-control text-ink hover:bg-sunk mt-1 flex min-h-11 items-center px-3 text-sm"
        >
          Notification settings
        </Link>
        <Button
          type="button"
          variant="ghost"
          loading={busy}
          onClick={() => void signOutNow()}
          className="text-ink w-full justify-start px-3"
        >
          Sign out
        </Button>
        {error ? (
          <p role="alert" className="text-danger px-3 pt-1 pb-2 text-xs font-medium">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  )
}
