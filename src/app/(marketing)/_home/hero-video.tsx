'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * The hero film: EverCalm in the places it is used, on the floor.
 *
 * Decoration around the real claim in the headline, so it is hidden from
 * assistive technology and summarised once in a caption, exactly as the
 * illustration it replaced was.
 *
 * What it costs is deliberate. The poster is what everybody gets first: the
 * page never waits on video to paint. Nothing is fetched until the component
 * decides it should play at all, and that decision respects three things -
 * reduced motion, Data Saver, and how wide the screen is. A phone that does
 * play gets a 0.9MB file rather than the 5MB one, because at that size it
 * cannot tell the difference.
 */

const POSTER = '/video/evercalm-hero-poster.webp'
const SOURCES = { small: '/video/evercalm-hero-480.mp4', large: '/video/evercalm-hero-960.mp4' }

export function HeroVideo() {
  const video = useRef<HTMLVideoElement>(null)
  const [source, setSource] = useState<string | null>(null)

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    // `connection` is not in every browser's lib.dom, and is the whole point here.
    const connection = (navigator as { connection?: { saveData?: boolean } }).connection
    if (reducedMotion.matches || connection?.saveData) return

    const decide = () => {
      setSource(window.matchMedia('(min-width: 640px)').matches ? SOURCES.large : SOURCES.small)
    }
    // After first paint: the headline and its call to action matter more than
    // this does, and must never queue behind it.
    const canIdle = typeof window.requestIdleCallback === 'function'
    const idle = canIdle
      ? window.requestIdleCallback(decide, { timeout: 2_000 })
      : window.setTimeout(decide, 600)

    const stop = () => {
      setSource(null)
      video.current?.pause()
    }
    reducedMotion.addEventListener('change', stop)
    return () => {
      reducedMotion.removeEventListener('change', stop)
      if (canIdle) window.cancelIdleCallback?.(idle)
      else window.clearTimeout(idle)
    }
  }, [])

  return (
    <div data-testid="hero-mock" className="relative">
      <p className="sr-only">
        A short film of EverCalm in use: a manager checking the day on a tablet behind the counter,
        and the team working through what the shift needs.
      </p>

      <div
        aria-hidden="true"
        data-testid="hero-video"
        className="border-line/70 relative overflow-hidden rounded-[1.15rem] border bg-white shadow-[0_24px_60px_-24px_rgb(20_32_44/0.28)]"
        style={{ aspectRatio: '16 / 9' }}
      >
        {/*
          The poster is a plain image, so it is what a first visit paints and
          what anyone who prefers reduced motion keeps. The video sits on top
          only once it is playing.
        */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={POSTER}
          alt=""
          width={960}
          height={540}
          className="absolute inset-0 h-full w-full object-cover"
        />
        {source ? (
          <video
            ref={video}
            src={source}
            poster={POSTER}
            autoPlay
            muted
            loop
            playsInline
            preload="none"
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : null}
      </div>
    </div>
  )
}
