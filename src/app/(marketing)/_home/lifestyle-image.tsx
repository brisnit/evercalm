import Image from 'next/image'
import { cn } from '@/lib/cn'
import type { LifestyleImage } from './imagery'

/**
 * A lifestyle photograph, or - until one is licensed - a placeholder that says
 * plainly what will go here. The box keeps its aspect ratio either way, so
 * swapping in the photo moves nothing. Always below the fold: lazy-loaded.
 */
export function LifestylePhoto({
  image,
  sizes,
  className,
}: {
  image: LifestyleImage
  sizes: string
  className?: string
}) {
  if (image.src) {
    return (
      <div
        className={cn('relative max-w-full overflow-hidden rounded-[1.15rem]', className)}
        style={{ aspectRatio: image.ratio }}
      >
        <Image
          src={image.src}
          alt={image.alt}
          fill
          sizes={sizes}
          loading="lazy"
          className="object-cover"
          style={image.position ? { objectPosition: image.position } : undefined}
        />
      </div>
    )
  }
  return (
    <figure
      data-placeholder-image={image.id}
      className={cn(
        'border-accent/30 relative flex max-w-full flex-col justify-end overflow-hidden rounded-[1.15rem] border border-dashed',
        'bg-[linear-gradient(160deg,#f7f5ff_0%,#eeebfa_55%,#fdeff8_100%)] p-4',
        className,
      )}
      style={{ aspectRatio: image.ratio }}
    >
      <span aria-hidden="true" className="text-accent/35 absolute top-4 left-4">
        <svg viewBox="0 0 24 24" fill="none" className="size-7">
          <rect
            x="3"
            y="5"
            width="18"
            height="14"
            rx="2.5"
            stroke="currentColor"
            strokeWidth="1.6"
          />
          <circle cx="9" cy="10.5" r="1.8" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="m5 17 4.5-4 3 2.5 3-3L19 16"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <figcaption className="text-quiet text-[0.8125rem] leading-snug">
        <span className="text-accent-strong block font-mono text-[0.625rem] tracking-[0.16em] uppercase">
          Photo placeholder
        </span>
        {image.alt}
      </figcaption>
    </figure>
  )
}
