'use client'

import { useEffect } from 'react'

/**
 * Gentle section reveals for the homepage.
 *
 * Marks the document ready only once it can observe, and only for people who
 * have not asked for reduced motion; anything already on screen, or anything
 * the observer has not reached within two seconds, is revealed regardless, so
 * motion can never hide content or delay reading.
 */
export function RevealOnScroll() {
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce || !('IntersectionObserver' in window)) return
    const root = document.documentElement
    const targets = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'))
    const show = (el: Element) => el.setAttribute('data-revealed', '')

    // Anything already visible shows immediately, before the page is marked.
    const vh = window.innerHeight
    for (const el of targets) {
      if (el.getBoundingClientRect().top < vh * 0.9) show(el)
    }
    root.dataset.motion = 'ready'

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            show(entry.target)
            observer.unobserve(entry.target)
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
    )
    targets.forEach((el) => {
      if (!el.hasAttribute('data-revealed')) observer.observe(el)
    })
    // Never leave anything hidden: printing, anchors, or a stalled observer.
    const safety = window.setTimeout(() => targets.forEach(show), 2000)
    const onHash = () => targets.forEach(show)
    window.addEventListener('hashchange', onHash)
    window.addEventListener('beforeprint', onHash)
    return () => {
      observer.disconnect()
      window.clearTimeout(safety)
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener('beforeprint', onHash)
      delete root.dataset.motion
    }
  }, [])
  return null
}
