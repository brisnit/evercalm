import { buttonClasses } from '@/ui/primitives/button'

/** Shared control styling for training forms, matching Input. */
export const TEXTAREA_CLASS =
  'rounded-control border-line-strong text-ink placeholder:text-faint w-full border bg-white px-3 py-2.5 text-sm leading-relaxed hover:border-faint focus:border-teal-600 aria-[invalid=true]:border-danger'

export const SELECT_CLASS =
  'rounded-control border-line-strong text-ink min-h-11 w-full border bg-white px-3 text-sm hover:border-faint focus:border-teal-600 aria-[invalid=true]:border-danger'

// Links that act as buttons take the button's own look, so round 2's coral
// primary never sits next to a leftover teal one on the same screen.
export const LINK_BUTTON_CLASS = buttonClasses('primary', 'md')

export const SECONDARY_LINK_CLASS = buttonClasses('secondary', 'md')
