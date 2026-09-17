/**
 * Only a rejected password is described as one. Too many attempts from one
 * network - several people trying demo accounts in turn, or one person
 * switching accounts quickly - is its own message, so it is not mistaken for
 * a wrong password or a broken sign-out.
 */
export function signInErrorMessage(status: number | undefined): string {
  if (status === 429) {
    return 'Too many sign-in attempts from this network in the last minute. Wait a minute, then try again.'
  }
  if (status !== undefined && status >= 500) {
    return 'Signing in is not working right now. Please try again in a moment.'
  }
  return 'That email and password combination did not match. Please try again.'
}

/**
 * Signing out ends the session on the server first, and only then loads the
 * sign-in page fresh, replacing the current history entry, so nothing of the
 * previous person stays in the browser. If the server could not be reached
 * the person stays where they are and is told, rather than being sent to a
 * sign-in page that would put them straight back.
 */
export const SIGN_OUT_FAILED = 'You could not be signed out. Check your connection and try again.'
