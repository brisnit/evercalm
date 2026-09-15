'use client'

import { RouteError } from '@/ui/patterns/route-states'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="mx-auto w-full max-w-xl px-5 py-7">
      <RouteError error={error} reset={reset} home={{ href: '/my', label: 'Back to your work' }} />
    </div>
  )
}
