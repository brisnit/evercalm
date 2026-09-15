/**
 * EMAIL PROVIDER INTERFACE.
 *
 * Transactional email sits behind this interface so no application code knows
 * which provider is in use. Until a sending domain is supplied and approved,
 * the development-safe 'console' provider is the default and sends nothing.
 *
 * The environment validator refuses to boot in production with the console
 * provider, so a development stub cannot silently become the production sender.
 */

export interface EmailMessage {
  to: string
  subject: string
  /** Plain-text body. HTML templates arrive with the first real email in Slice 2. */
  text: string
  replyTo?: string
  /** Stable per logical message, so a retried send is not delivered twice. */
  idempotencyKey?: string
}

/**
 * The provider refused the message for a reason that will not change on a
 * retry: an invalid address, an unverified sender, a revoked key.
 */
export class PermanentEmailError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PermanentEmailError'
  }
}

export interface SendResult {
  id: string
  delivered: boolean
  provider: string
}

export interface EmailProvider {
  readonly name: string
  send(message: EmailMessage): Promise<SendResult>
}
