import * as React from 'react'
import { cn } from '@/lib/cn'

/**
 * Button.
 *
 * Brand pink is never used as a text-bearing fill: at 3.79:1 white text on
 * #EA33A9 fails AA. The primary action is violet-600 (6.13:1).
 */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-violet-600 text-white hover:bg-violet-700 active:bg-violet-800 border border-transparent',
  secondary: 'bg-white text-ink border border-line-strong hover:bg-sunk active:bg-line/60',
  ghost: 'bg-transparent text-muted border border-transparent hover:bg-sunk hover:text-ink',
  danger: 'bg-danger text-white hover:bg-[#a31f1f] border border-transparent',
}

const SIZES: Record<Size, string> = {
  // 44px minimum touch target on employee screens (WCAG 2.2 target size).
  sm: 'min-h-9 px-3 text-sm gap-1.5',
  md: 'min-h-11 px-4 text-sm gap-2',
  lg: 'min-h-12 px-6 text-base gap-2',
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  /** Renders a busy state and blocks repeat submits. */
  loading?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', loading = false, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled ?? loading}
      aria-busy={loading || undefined}
      className={cn(
        'rounded-control inline-flex items-center justify-center font-medium',
        'transition-colors duration-150',
        'disabled:cursor-not-allowed disabled:opacity-55',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? (
        <>
          <span
            aria-hidden="true"
            className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
          <span>Working…</span>
        </>
      ) : (
        children
      )}
    </button>
  )
})
