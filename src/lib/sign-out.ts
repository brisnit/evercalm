'use client'

import { signOut } from './auth-client'

/**
 * End the session, then load the sign-in page fresh. Throws when the server
 * did not end the session, so the caller can say so instead of navigating to
 * a sign-in page that would redirect a still-signed-in person back in.
 */
export async function signOutAndLeave(): Promise<void> {
  const result = await signOut()
  if (result?.error) throw new Error(result.error.message ?? 'Sign-out failed')
  window.location.replace('/signin')
}
