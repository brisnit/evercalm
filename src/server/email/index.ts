import { getEnv } from '@/lib/env'
import { ConfigurationError } from '@/lib/errors'
import { ConsoleEmailProvider } from './console-provider'
import type { EmailProvider } from './provider'

export type { EmailMessage, EmailProvider, SendResult } from './provider'

let cached: EmailProvider | undefined

export function emailProvider(): EmailProvider {
  if (cached) return cached
  const env = getEnv()

  switch (env.EMAIL_PROVIDER) {
    case 'console':
      cached = new ConsoleEmailProvider()
      return cached
    case 'resend':
      // Deliberately not implemented until a sending domain is supplied and
      // approved. Failing loudly beats silently falling back to a stub.
      throw new ConfigurationError(
        'The Resend provider is not wired up yet. A verified sending domain must be ' +
          'supplied and approved first. Set EMAIL_PROVIDER=console for development.',
      )
  }
}

export function resetEmailProvider(): void {
  cached = undefined
}
