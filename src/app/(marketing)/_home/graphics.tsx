import { cn } from '@/lib/cn'

/**
 * EVERCALM'S GRAPHIC LANGUAGE.
 *
 * Round 2's feedback was specific about what it liked and why:
 *
 *   "This two-tone page break is sick."
 *   "I like the white background with the small design elements like the
 *    quotes and the graphic behind the photo."
 *
 * So the shapes are taken from the reference and the colours are not: the
 * reference was rust-on-rust, and EverCalm is navy, cream, mint, deep teal
 * and coral.
 *
 * The ambient discs that used to float behind every section are gone: the
 * backgrounds are plain, and the one place that keeps a field of colour is
 * the closing tout, where it is the point rather than the wallpaper. What
 * remains here is used deliberately, one element at a time, and every piece
 * is aria-hidden - none of it carries meaning that is not also written down.
 */

/** The colour fields a section can be, for the two-tone break. */
type Tone = 'cream' | 'navy' | 'teal' | 'white'

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
