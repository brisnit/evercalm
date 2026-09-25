import Link from 'next/link'
import { cn } from '@/lib/cn'
import { ToolIcon, type ToolIconName } from './tool-icon'

/**
 * One tool on a launcher: an icon, a short name, and at most one line of
 * status. The whole card is the link. `tone="attention"` marks a status that
 * asks for someone - a small coral dot, never a tinted card.
 */
export function ToolCard({
  href,
  label,
  icon,
  status,
  tone = 'calm',
  size = 'md',
  heading,
  className,
  testId,
}: {
  href: string
  label: string
  icon: ToolIconName
  status?: string | null
  tone?: 'calm' | 'attention'
  size?: 'md' | 'sm'
  /** Render the name as a heading, so the launcher can be read by headings. */
  heading?: 'h2' | 'h3'
  className?: string
  testId?: string
}) {
  const Name = heading ?? 'span'
  return (
    <Link
      href={href}
      data-testid={testId}
      className={cn(
        'group rounded-card border-line flex min-w-0 border bg-white transition-[border-color,box-shadow,transform]',
        'hover:border-teal-300 hover:shadow-[0_6px_20px_-12px_rgba(30,45,61,0.35)] active:translate-y-px',
        'focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2',
        size === 'md'
          ? 'min-h-28 flex-col justify-between gap-3 p-4 sm:min-h-32 sm:gap-4 sm:p-5'
          : 'min-h-[4.5rem] items-center gap-3 px-4 py-3',
        className,
      )}
    >
      <span
        className={cn(
          'bg-tile group-hover:bg-sage-200 flex shrink-0 items-center justify-center rounded-xl text-teal-700 transition-colors',
          size === 'md' ? 'size-11' : 'size-10',
        )}
      >
        <ToolIcon name={icon} />
      </span>
      <span className="flex min-w-0 flex-col">
        <Name className="font-display text-ink block text-base leading-tight font-bold sm:text-[1.0625rem]">
          {label}
        </Name>
        {status ? (
          <span
            className={cn(
              'mt-1 flex items-start gap-1.5 text-sm leading-snug',
              tone === 'attention' ? 'text-ink' : 'text-muted',
            )}
          >
            {tone === 'attention' ? (
              <span
                aria-hidden="true"
                className="bg-coral-400 mt-[0.4em] size-2 shrink-0 rounded-full"
              />
            ) : null}
            <span className="min-w-0">{status}</span>
          </span>
        ) : null}
      </span>
    </Link>
  )
}
