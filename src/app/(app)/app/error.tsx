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
    <RouteError error={error} reset={reset} home={{ href: '/app', label: 'Back to overview' }} />
  )
}
