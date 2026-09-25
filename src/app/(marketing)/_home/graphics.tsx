import { cn } from '@/lib/cn'

/**
 * EVERCALM'S GRAPHIC LANGUAGE.
 *
 * Round 2's feedback was specific about what it liked and why:
 *
 *   "These background graphics are very pleasing to the eyes."
 *   "This two-tone page break is sick."
 *   "I like the graphics and background, but not the color choice."
 *
 * So the shapes are taken from the reference and the colours are not: the
 * reference was rust-on-rust, and EverCalm is navy, cream, mint, deep teal
 * and coral. Everything here is built from those tokens.
 *
 * Two rules keep it from becoming noise. Shapes are DECORATION - every one is
 * aria-hidden and none carries meaning that is not also written down. And the
 * page alternates: an expressive section, then a calm one, so the geometry
 * reads as rhythm rather than wallpaper.
 */

/* -------------------------------------------------------------------------
   Fields of shape behind a section
   ---------------------------------------------------------------------- */

type Tone = 'cream' | 'navy' | 'teal' | 'white'

/**
 * Oversized circles and arcs, cropped by the section they sit in.
 *
 * `overflow-hidden` on the section is what does the work: shapes are laid out
 * larger than the box on purpose, so what you see is a fragment of something
 * bigger, which is what makes the reference feel art-directed rather than
 * decorated.
 */
export function ShapeField({ tone, className }: { tone: Tone; className?: string }) {
  return (
    <div aria-hidden="true" className={cn('pointer-events-none absolute inset-0', className)}>
      {tone === 'cream' ? (
        <>
          {/* Mint disc, top right, mostly off the edge. */}
          <span className="bg-sage-100 absolute -top-[22rem] -right-[14rem] hidden size-[46rem] rounded-full sm:block" />
          {/* A smaller coral one, low and left, to weight the other corner. */}
          <span className="bg-coral-100 absolute -bottom-[18rem] -left-[12rem] size-[34rem] rounded-full opacity-80" />
          {/* One teal quarter-circle, cropped by the right edge. */}
          <span className="absolute top-[38%] -right-[8rem] hidden size-[18rem] rounded-full bg-teal-100 lg:block" />
        </>
      ) : null}

      {tone === 'navy' ? (
        <>
          <span className="absolute -top-[16rem] -left-[10rem] size-[38rem] rounded-full bg-[#1b2d3d]" />
          <span className="absolute -right-[12rem] -bottom-[20rem] size-[42rem] rounded-full bg-teal-800/70" />
          <span className="bg-coral-400/15 absolute top-[12%] right-[14%] hidden size-[11rem] rounded-full lg:block" />
        </>
      ) : null}

      {tone === 'teal' ? (
        <>
          <span className="bg-coral-600 absolute -top-[10rem] -left-[16rem] size-[34rem] rounded-full" />
          <span className="bg-coral-200 absolute -top-[9rem] left-[44%] size-[19rem] rounded-full" />
          <span className="absolute -right-[10rem] -bottom-[14rem] size-[30rem] rounded-full bg-[#2f4a6b]" />
        </>
      ) : null}

      {tone === 'white' ? (
        <>
          <span className="bg-sage-50 absolute -top-[10rem] -left-[8rem] size-[26rem] rounded-full" />
          <span className="bg-coral-50 absolute right-[6%] bottom-[8%] hidden size-[15rem] rounded-full lg:block" />
        </>
      ) : null}
    </div>
  )
}

/**
 * One arc peeking out from behind a photograph.
 *
 * Round 2: "I like the white background with the small design elements like
 * the quotes and the graphic behind the photo." This is that graphic - a
 * quarter of a large circle, offset so it reads as something the photo is
 * sitting on top of.
 */
export function ArcBehind({
  className,
  tone = 'coral',
}: {
  className?: string
  tone?: 'coral' | 'mint' | 'teal'
}) {
  const fill = tone === 'coral' ? 'bg-coral-400' : tone === 'mint' ? 'bg-sage-300' : 'bg-teal-400'
  return (
    <span
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute size-[13rem] rounded-full',
        'rounded-br-none',
        fill,
        className,
      )}
    />
  )
}

/* -------------------------------------------------------------------------
   The two-tone page break
   ---------------------------------------------------------------------- */

const BREAK_TONE: Record<Tone, string> = {
  cream: 'bg-lift',
  navy: 'bg-band',
  teal: 'bg-teal-800',
  white: 'bg-white',
}

/**
 * Where one colour field gives way to another, geometrically.
 *
 * The stakeholder called this out by name. It is a shallow chevron rather
 * than a straight rule: the section above keeps its colour, and the one below
 * pushes up into it at a point off-centre, so the seam is a deliberate shape
 * instead of an edge.
 *
 * `from` is the colour above. Whatever is underneath shows through the cut,
 * so the element only ever paints one colour and never has to know the other.
 */
export function SectionBreak({
  from,
  height = 'h-16 sm:h-24',
  peak = 58,
  className,
}: {
  from: Tone
  /** How tall the transition is. */
  height?: string
  /** Where the point sits, as a percentage across. */
  peak?: number
  className?: string
}) {
  return (
    <div
      aria-hidden="true"
      className={cn('w-full', height, BREAK_TONE[from], className)}
      style={{
        clipPath: `polygon(0 0, 100% 0, 100% 46%, ${peak}% 100%, 0 62%)`,
      }}
    />
  )
}

/* -------------------------------------------------------------------------
   Editorial marks
   ---------------------------------------------------------------------- */

/** The oversized quotation mark from the reference's pull-quote band. */
export function QuoteMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 64 48"
      className={cn('pointer-events-none absolute', className)}
      fill="currentColor"
    >
      <path d="M0 48V26.5C0 11.9 8.8 2 23 0l3 7.5C18 10 13.5 15 13 22h11v26H0Zm40 0V26.5C40 11.9 48.8 2 63 0l1 7.5C56 10 53.5 15 53 22h11v26H40Z" />
    </svg>
  )
}

/**
 * The three-colour rule under a statement, from the reference card.
 *
 * Teal, coral, navy: the palette stated in one small gesture.
 */
export function TriRule({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn('inline-flex h-[3px] w-28 overflow-hidden', className)}>
      <span className="flex-1 bg-teal-600" />
      <span className="bg-coral-500 flex-1" />
      <span className="bg-band flex-1" />
    </span>
  )
}

/** A small × mark, as used in the reference's hero geometry. */
export function CrossMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={cn('pointer-events-none absolute', className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    >
      <path d="M3 3l10 10M13 3L3 13" />
    </svg>
  )
}
