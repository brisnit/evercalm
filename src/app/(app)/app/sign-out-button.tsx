'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { signOut } from '@/lib/auth-client'
import { Button } from '@/ui/primitives'

export function SignOutButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  return (
    <Button
      variant="ghost"
      size="sm"
      loading={busy}
      onClick={() => {
        setBusy(true)
        void signOut().then(() => {
          router.push('/signin')
          router.refresh()
        })
      }}
    >
      Sign out
    </Button>
  )
}
