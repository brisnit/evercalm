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
