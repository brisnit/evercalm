import { newId } from '@/lib/ids'
import { getLogger } from '@/lib/logger'
import type { EmailMessage, EmailProvider, SendResult } from './provider'

/**
 * Development-safe provider. Sends nothing; records that a send was requested.
 *
 * The recipient address is logged at debug level only and is redacted by the
 * logger's PII rules, so a development log never becomes an address list.
 */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console'

  send(message: EmailMessage): Promise<SendResult> {
    const id = newId()
    getLogger().info(
      { emailId: id, subject: message.subject, provider: this.name },
      'email suppressed (development-safe console provider)',
    )
    getLogger().debug({ emailId: id, to: message.to }, 'email recipient')
    return Promise.resolve({ id, delivered: false, provider: this.name })
  }
}
