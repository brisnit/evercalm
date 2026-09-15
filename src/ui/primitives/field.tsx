import * as React from 'react'
import { cn } from '@/lib/cn'

/**
 * Form field.
 *
 * The label is always a real <label> bound by id, the error is announced via
 * role="alert", and aria-describedby links hint and error text to the control.
 * Error state is never communicated by colour alone - it carries text.
 */

export interface FieldProps {
  id: string
  label: string
  hint?: string
  error?: string
  required?: boolean
  children: (props: {
    id: string
    'aria-describedby': string | undefined
    'aria-invalid': boolean | undefined
    'aria-required': boolean | undefined
  }) => React.ReactNode
}

export function Field({ id, label, hint, error, required, children }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-ink text-sm font-medium">
        {label}
        {required ? (
          <span className="text-pink-700" aria-hidden="true">
            {' '}
            *
          </span>
        ) : null}
        {required ? <span className="sr-only"> (required)</span> : null}
      </label>

      {hint ? (
        <p id={hintId} className="text-muted text-xs">
          {hint}
        </p>
      ) : null}

      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
        'aria-required': required ? true : undefined,
      })}

      {error ? (
        <p id={errorId} role="alert" className="text-danger text-xs font-medium">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/**
 * The boundary every text control shares. `field` is 3:1 against white and the
 * canvas, as WCAG 1.4.11 asks of a control's edge; 16px text on a phone stops
 * iOS zooming the page when a field is focused.
 */
export const CONTROL = cn(
  'rounded-control border-field w-full border bg-white',
  'text-ink placeholder:text-faint text-base sm:text-sm',
  'hover:border-ink/60 focus:border-violet-600',
  'aria-[invalid=true]:border-danger',
  'disabled:bg-sunk disabled:text-muted disabled:border-line-strong disabled:cursor-not-allowed',
)

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(CONTROL, 'min-h-11 px-3', className)} {...props} />
})

/** A native select, dressed like the other controls, with its own chevron. */
export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, children, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={cn(
        CONTROL,
        'min-h-11 appearance-none bg-white [background-size:1rem] [background-position:right_0.75rem_center] [background-repeat:no-repeat] pr-9 pl-3',
        "[background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none'%3E%3Cpath d='M4 6l4 4 4-4' stroke='%235a5766' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")]",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  )
})

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(CONTROL, 'px-3 py-2.5 leading-relaxed', className)}
      {...props}
    />
  )
})
