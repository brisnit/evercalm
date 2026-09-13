import Image from 'next/image'
import { cn } from '@/lib/cn'
import { WORDMARK, WORDMARK_NEEDS_LIGHT_BACKGROUND } from '../brand'

/**
 * EverCalm wordmark.
 *
 * Sized with a Tailwind height class rather than a pixel number, so a caller
 * can be responsive - the marketing header is deliberately large on a desktop
 * and smaller on a phone. Width always follows the asset's aspect ratio.
 *
 * Swapping the PNG for a production SVG means editing src/ui/brand.ts and
 * nothing else.
 */
export function Logo({
  size = 'h-8',
  onDark = false,
  className,
  eager = false,
}: {
  /** Tailwind height class(es), e.g. `h-10 sm:h-15`. */
  size?: string
  onDark?: boolean
  className?: string
  /** Set on above-the-fold marks. `priority` is deprecated in Next 16. */
  eager?: boolean
}) {
  const needsChip = onDark && WORDMARK_NEEDS_LIGHT_BACKGROUND

  return (
    <span
      className={cn(
        'inline-flex items-center',
        needsChip && 'rounded-[10px] bg-white px-2.5 py-1.5',
        className,
      )}
    >
      <Image
        src={WORDMARK.src}
        alt="EverCalm"
        width={WORDMARK.intrinsicWidth}
        height={WORDMARK.intrinsicHeight}
        loading={eager ? 'eager' : 'lazy'}
        fetchPriority={eager ? 'high' : 'auto'}
        className={cn('w-auto', size)}
      />
    </span>
  )
}
