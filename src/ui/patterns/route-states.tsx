'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import { buttonClasses } from '@/ui/primitives/button'

/*
 * Route-level states shared by the three shells: what a person sees when a
 * page fails and when it does not exist. Each keeps the shell around it, says
 * plainly what happened, and offers a way on.
 *
 * There is deliberately no route `loading.tsx`: a loading boundary makes the
 * response stream, and a streamed response is committed to 200 before the page
 * can call notFound() - so another tenant's record would answer 200 instead of
 * 404. The navigation progress bar gives loading feedback instead.
 */

export function RouteError({
  error,
  reset,
  home,
}: {
  error: Error & { digest?: string }
  reset: () => void
  home: { href: string; label: string }
}) {
  useEffect(() => {
    // The server has already logged it with the digest; this helps in the console.
    console.warn('Page failed to render', error.digest ?? '')
  }, [error])

  return (
    <div
      role="alert"
      className="rounded-card border-line mx-auto mt-6 max-w-lg border bg-white p-8 text-center"
    >
      <h1 className="font-display text-ink text-xl font-extrabold">This page didn’t load</h1>
      <p className="text-muted mt-3 text-sm">
        Something went wrong on our side. Nothing you entered was lost. Try again, and if it keeps
        happening, open a support case and mention the reference below.
      </p>
      {error.digest ? (
        <p className="text-faint mt-3 font-mono text-xs">Reference {error.digest}</p>
      ) : null}
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button type="button" onClick={reset} className={buttonClasses('primary')}>
          Try again
        </button>
        <Link href={home.href} className={buttonClasses('secondary')}>
          {home.label}
        </Link>
      </div>
    </div>
  )
}

export function RouteNotFound({ home }: { home: { href: string; label: string } }) {
  return (
    <div className="rounded-card border-line mx-auto mt-6 max-w-lg border bg-white p-8 text-center">
      <h1 className="font-display text-ink text-xl font-extrabold">We couldn’t find that page</h1>
      <p className="text-muted mt-3 text-sm">
        It may have been removed, or the link may be for a different workspace.
      </p>
      <div className="mt-6 flex justify-center">
        <Link href={home.href} className={buttonClasses('primary')}>
          {home.label}
        </Link>
      </div>
    </div>
  )
}
