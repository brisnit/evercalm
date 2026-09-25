import * as React from 'react'
import { cn } from '@/lib/cn'

/**
 * Button.
 *
 * The primary action is coral-600 (white on it is 4.71:1 - AA): round 2 puts
 * the main move of every screen in coral. Brand Coral Pop itself (2.62:1)
 * stays a fill, border and icon colour only, and destructive stays crimson so
 * it can never read as a coral accent.
 */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-action shadow-low hover:bg-action-hover hover:shadow-lift active:bg-action-hover border border-transparent text-white',
  secondary:
    'bg-white text-ink border border-field/70 shadow-low hover:bg-teal-50 hover:border-teal-400 active:bg-teal-100',
  ghost: 'bg-transparent text-muted border border-transparent hover:bg-sunk hover:text-ink',
  danger: 'bg-danger text-white hover:bg-[#8f1424] active:bg-[#76101e] border border-transparent',
}

const SIZES: Record<Size, string> = {
  // 44px minimum touch target on employee screens (WCAG 2.2 target size).
  sm: 'min-h-9 px-3 text-sm gap-1.5',
  md: 'min-h-11 px-4 text-sm gap-2',
  lg: 'min-h-12 px-6 text-base gap-2',
}

/** The button look, for anything that must be a link but act as a button. */
export function buttonClasses(variant: Variant = 'primary', size: Size = 'md', className?: string) {
  return cn(
    'rounded-control inline-flex items-center justify-center font-medium select-none',
    'transition-[background-color,border-color,color,transform] duration-150',
    'active:translate-y-px motion-reduce:active:translate-y-0',
    'disabled:cursor-not-allowed disabled:opacity-60 disabled:active:translate-y-0',
    'aria-disabled:pointer-events-none aria-disabled:opacity-60',
    VARIANTS[variant],
    SIZES[size],
    className,
  )
}

export type ButtonVariant = Variant
export type ButtonSize = Size

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
      className={buttonClasses(variant, size, className)}
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
