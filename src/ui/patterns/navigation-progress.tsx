'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

/**
 * A thin teal bar at the top of the window while the next page is on its
 * way. Pages here are rendered on the server, so without it a slow query
 * looks like a click that did nothing.
 *
 * Deliberately reads neither search params nor anything else that needs a
 * Suspense boundary: a boundary in a layout makes every page below it stream,
 * and a streamed response is committed to 200 before a page can answer 404 -
 * which would turn another tenant's record into a soft 404.
 *
 * Starts on a same-origin link click, marking that link as on its way; stops when the address changes (checked
 * cheaply while it runs) or after a few seconds. Purely visual (aria-hidden).
 * Reduced motion shows a still bar.
 */
export function NavigationProgress() {
  const pathname = usePathname()
  const [active, setActive] = useState(false)

  useEffect(() => setActive(false), [pathname])

  // The link that was pressed shows it straight away, so a person sees their
  // tap land even while the next page is still on the server.
  useEffect(() => {
    if (active) return
    for (const link of document.querySelectorAll('a[data-navigating]')) {
      link.removeAttribute('data-navigating')
    }
  }, [active])

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = (event.target as Element | null)?.closest?.('a[href]')
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === '_blank') return
      if (anchor.hasAttribute('download')) return
      const url = new URL(anchor.href, window.location.href)
      if (url.origin !== window.location.origin) return
      if (url.pathname === window.location.pathname && url.search === window.location.search) return
      anchor.setAttribute('data-navigating', '')
      setActive(true)
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  useEffect(() => {
    if (!active) return
    const started = window.location.href
    const poll = window.setInterval(() => {
      if (window.location.href !== started) setActive(false)
    }, 120)
    const giveUp = window.setTimeout(() => setActive(false), 8000)
    return () => {
      window.clearInterval(poll)
      window.clearTimeout(giveUp)
    }
  }, [active])

  if (!active) return null
  return (
    <div aria-hidden="true" className="fixed inset-x-0 top-0 z-50 h-1 overflow-hidden bg-teal-100">
      <div className="to-sage-400 h-full w-2/5 bg-gradient-to-r from-teal-600 motion-safe:animate-[ec-progress_1.1s_ease-in-out_infinite]" />
    </div>
  )
}
