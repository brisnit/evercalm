import Image from 'next/image'
import { cn } from '@/lib/cn'
import { WORDMARK, WORDMARK_NEEDS_LIGHT_BACKGROUND } from '../brand'

/**
 * EverCalm wordmark.
 *
 * Sized by height; width follows the asset's aspect ratio. Swapping the
 * temporary PNG for a production SVG means editing src/ui/brand.ts and
 * nothing else.
 */
export function Logo({
  height = 28,
  onDark = false,
  className,
  priority = false,
}: {
  height?: number
  onDark?: boolean
  className?: string
  priority?: boolean
}) {
  const width = Math.round(height * WORDMARK.aspectRatio)
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
        width={width}
        height={height}
        priority={priority}
        style={{ height, width: 'auto' }}
      />
    </span>
  )
}
