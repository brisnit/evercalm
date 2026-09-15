import { getEnv } from '@/lib/env'
import { ConsoleEmailProvider } from './console-provider'
import { DisabledEmailProvider } from './disabled-provider'
import { ResendEmailProvider } from './resend-provider'
import type { EmailProvider } from './provider'

export type { EmailMessage, EmailProvider, SendResult } from './provider'
export { PermanentEmailError } from './provider'

let cached: EmailProvider | undefined

export function emailProvider(): EmailProvider {
  if (cached) return cached
  const env = getEnv()

  switch (env.EMAIL_PROVIDER) {
    case 'console':
      cached = new ConsoleEmailProvider()
      return cached
    case 'resend':
      // The environment check guarantees a key and a real sender here.
      cached = new ResendEmailProvider({ apiKey: env.RESEND_API_KEY!, from: env.EMAIL_FROM })
      return cached
    case 'disabled':
      // No email notifications are created when email is disabled (see
      // notifications enqueue); anything that still asks refuses loudly.
      cached = new DisabledEmailProvider()
      return cached
  }
}

export function resetEmailProvider(): void {
  cached = undefined
}
