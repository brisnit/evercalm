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

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        'rounded-control border-line-strong min-h-11 w-full border bg-white px-3',
        'text-ink placeholder:text-faint text-sm',
        'hover:border-faint focus:border-violet-600',
        'aria-[invalid=true]:border-danger',
        'disabled:bg-sunk disabled:text-muted disabled:cursor-not-allowed',
        className,
      )}
      {...props}
    />
  )
})
