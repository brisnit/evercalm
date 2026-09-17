import Link from 'next/link'
import { cn } from '@/lib/cn'
import { buttonClasses, type ButtonSize, type ButtonVariant } from './button'

/*
 * LINKS.
 *
 * Three looks, so what is clickable is obvious and consistent:
 *
 *   ButtonLink  navigation that is the page's action ("Invite someone"). Same
 *               variants and sizes as Button.
 *   TextLink    navigation inside or beside text. Always teal and
 *               underlined, never colour alone. `standalone` gives a link that
 *               sits on its own a 44px tall hit area.
 *   BackLink    the way up from a detail page, in the same place every time.
 */

type LinkProps = Omit<React.ComponentProps<typeof Link>, 'className'> & { className?: string }

export function ButtonLink({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: LinkProps & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link {...props} className={buttonClasses(variant, size, className)} />
}

export function TextLink({
  standalone = false,
  className,
  ...props
}: LinkProps & { standalone?: boolean }) {
  return (
    <Link
      {...props}
      className={cn(
        'font-medium text-teal-700 underline decoration-teal-300 decoration-1 underline-offset-4',
        'transition-colors hover:text-teal-800 hover:decoration-teal-700',
        standalone && 'inline-flex min-h-11 items-center',
        className,
      )}
    />
  )
}

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="text-muted hover:text-ink group rounded-control -ml-1 inline-flex min-h-11 items-center gap-1.5 px-1 text-sm font-medium"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className="size-4 transition-transform group-hover:-translate-x-0.5 motion-reduce:transition-none"
        fill="none"
      >
        <path
          d="M10 3.5 5.5 8l4.5 4.5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {children}
    </Link>
  )
}
