'use client'

import { retryFailedNotificationsAction } from '@/modules/status/actions'
import { MiniForm } from '@/ui/patterns/mini-form'

export function RetryButton({ count }: { count: number }) {
  return (
    <MiniForm
      action={retryFailedNotificationsAction}
      hidden={{}}
      submitLabel={`Try ${count} failed ${count === 1 ? 'notification' : 'notifications'} again`}
    />
  )
}
