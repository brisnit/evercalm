import Image from 'next/image'
import { IMAGERY, type LifestyleImage } from './imagery'

/**
 * THE OPENING BAND OF PEOPLE.
 *
 * Round 2: "The opening screen with multiple shots of people, like below, is
 * a good idea." The reference puts three photographs across the width at
 * different scales, with one piece of product floating over the middle of
 * them, so the first thing the page says is PEOPLE and SHIFTS rather than
 * DASHBOARD. These are the same three photographs, in the same arrangement:
 * the pass, the room at close, the chair.
 *
 * One grid, reordered rather than duplicated. On a phone the team shot takes
 * the full width and the two portraits sit beneath it as a pair - still
 * people, at a size worth looking at, rather than the three thumbnails the
 * brief ruled out.
 */
export function HeroPeople() {
  const left: LifestyleImage = IMAGERY.prepForService
  const centre: LifestyleImage = IMAGERY.closingTogether
  const right: LifestyleImage = IMAGERY.stylistStation

  return (
    <div
      data-testid="hero-people"
      className="grid grid-cols-2 items-end gap-3 sm:gap-4 lg:grid-cols-[0.58fr_1.5fr_0.58fr]"
    >
      <Still image={left} className="order-2 lg:order-1" />

      {/* The room at the end of the night, with a note from the floor on it. */}
      <div data-testid="hero-mock" className="relative order-1 col-span-2 lg:order-2 lg:col-span-1">
        <div
          data-testid="hero-still"
          className="relative overflow-hidden rounded-[1.15rem] shadow-[0_30px_60px_-28px_rgb(20_32_44/0.55)]"
          style={{ aspectRatio: '16 / 10' }}
        >
          <Image
            src={centre.src!}
            alt={centre.alt}
            fill
            sizes="(min-width: 1024px) 50vw, 92vw"
            priority
            className="object-cover"
            style={{ objectPosition: '50% 42%' }}
          />
        </div>

        {/*
          One piece of real product over the photography. It is the huddle
          note from the reference, and it is what makes the band read as
          "people, shifts, software" rather than a gallery.
        */}
        <div className="absolute -bottom-5 left-4 w-[15.5rem] max-w-[calc(100%-2rem)] rounded-[0.95rem] bg-white p-3.5 shadow-[0_24px_44px_-20px_rgb(20_32_44/0.45)] ring-1 ring-black/5 sm:-bottom-7 sm:left-7">
          <p className="text-coral-700 font-mono text-[0.5625rem] tracking-[0.14em] uppercase">
            Huddle · 4:45p
          </p>
          <p className="text-deep mt-1.5 text-[0.8125rem] leading-snug font-semibold">
            Patio opens at 4. Ramos is out — Devon covers section 3.
          </p>
          <p className="text-muted mt-1.5 text-[0.6875rem]">Read by 12 of 14 before the shift</p>
        </div>
      </div>

      <Still image={right} className="order-3" />
    </div>
  )
}

/** Above the fold, so it is fetched with the page rather than after it. */
function Still({ image, className }: { image: LifestyleImage; className?: string }) {
  return (
    <div
      className={`relative mt-10 overflow-hidden rounded-[1.15rem] shadow-[0_26px_50px_-28px_rgb(20_32_44/0.5)] sm:mt-12 lg:mt-0 ${className ?? ''}`}
    >
      <div className="relative" style={{ aspectRatio: '4 / 5' }}>
        <Image
          src={image.src!}
          alt={image.alt}
          fill
          sizes="(min-width: 1024px) 19vw, 46vw"
          priority
          className="object-cover"
          style={image.position ? { objectPosition: image.position } : undefined}
        />
      </div>
    </div>
  )
}
