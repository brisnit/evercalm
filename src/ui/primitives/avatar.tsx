import { cn } from '@/lib/cn'

/**
 * Initials avatar.
 *
 * No photo uploads yet, so this derives a stable colour from the name rather
 * than showing an empty grey circle. The initials are decorative - the name is
 * always rendered beside it, so this carries `aria-hidden`.
 */

/*
 * Decorative only, and drawn from the palette's own scales rather than the
 * semantic colours: an avatar tinted "warning" or "danger" would read as a
 * status the person does not have. Every pair is at least 5.8:1.
 */
const TONES = [
  'bg-teal-100 text-teal-800', // 9.72:1
  'bg-sage-200 text-sage-800', // 5.89:1
  'bg-sand-300 text-sand-900', // 7.70:1
  'bg-coral-100 text-coral-800', // 6.32:1
  'bg-navy-100 text-navy-700', // 9.72:1
  'bg-teal-50 text-teal-700', // 8.83:1
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
