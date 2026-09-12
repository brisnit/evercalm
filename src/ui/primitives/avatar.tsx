import { cn } from '@/lib/cn'

/**
 * Initials avatar.
 *
 * No photo uploads yet, so this derives a stable colour from the name rather
 * than showing an empty grey circle. The initials are decorative - the name is
 * always rendered beside it, so this carries `aria-hidden`.
 */

const TONES = [
  'bg-violet-100 text-violet-800',
  'bg-pink-100 text-pink-800',
  'bg-info-soft text-info',
  'bg-success-soft text-success',
  'bg-warning-soft text-warning',
  'bg-sunk text-muted',
] as const

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? '?'
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  return (first + last).toUpperCase()
}

function toneFor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return TONES[hash % TONES.length] ?? TONES[0]
}

export function Avatar({
  name,
  size = 'md',
  className,
}: {
  name: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const dimension = { sm: 'size-8 text-xs', md: 'size-10 text-sm', lg: 'size-14 text-base' }[size]
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold',
        dimension,
        toneFor(name),
        className,
      )}
    >
      {initials(name)}
    </span>
  )
}
