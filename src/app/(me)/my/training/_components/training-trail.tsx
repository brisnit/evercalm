import { BackLink, TextLink } from '@/ui/primitives'

/**
 * The way out of a course, at the top of every course and lesson screen.
 *
 * Progress saves as each step is done, so leaving is always safe: one link
 * goes up a level, the other leaves training altogether. It sits in the page
 * itself, not only in the header, so it is the first thing seen on any width.
 */
export function TrainingTrail({
  up,
  across = { href: '/my/training', label: 'Exit to Training' },
}: {
  up: { href: string; label: string }
  across?: { href: string; label: string }
}) {
  return (
    <nav
      aria-label="Leave this course"
      data-testid="training-trail"
      className="-mt-3 mb-4 flex flex-wrap items-center justify-between gap-x-4"
    >
      <BackLink href={up.href}>{up.label}</BackLink>
      <TextLink href={across.href} standalone className="text-sm">
        {across.label}
      </TextLink>
    </nav>
  )
}
