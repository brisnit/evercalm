'use client'

import { adoptFromLibraryAction } from '@/modules/training/actions'
import { MiniForm } from '@/ui/patterns/mini-form'

/** Take a ready-made course, as a draft this organization owns. */
export function AdoptButton({ courseKey, title }: { courseKey: string; title: string }) {
  return (
    <MiniForm
      action={adoptFromLibraryAction}
      hidden={{ key: courseKey }}
      submitLabel="Add it as a draft"
      variant="primary"
      className="mt-auto"
    >
      <p className="text-faint text-xs">
        Creates “{title}” here. You edit and publish it yourself.
      </p>
    </MiniForm>
  )
}
