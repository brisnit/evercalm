'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

/**
 * A thin violet bar at the top of the window while the next page is on its
 * way. Pages here are rendered on the server, so without it a slow query
 * looks like a click that did nothing.
 *
 * Starts on a same-origin link click and stops when the URL changes. Purely
 * visual (aria-hidden): each route's loading skeleton announces loading to
 * assistive technology. Reduced motion shows a still bar.
 */
export function NavigationProgress() {
  const pathname = usePathname()
  const search = useSearchParams()
  const [active, setActive] = useState(false)

  useEffect(() => setActive(false), [pathname, search])

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
      setActive(true)
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  if (!active) return null
  return (
    <div
      aria-hidden="true"
      className="fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-violet-100"
    >
      <div className="h-full w-2/5 bg-gradient-to-r from-violet-600 to-pink-500 motion-safe:animate-[ec-progress_1.1s_ease-in-out_infinite]" />
    </div>
  )
}
