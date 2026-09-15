import { newId } from '@/lib/ids'
import {
  PermanentEmailError,
  type EmailMessage,
  type EmailProvider,
  type SendResult,
} from './provider'

/*
 * RESEND.
 *
 * One HTTPS call per message to Resend's send endpoint, with no SDK: the
 * surface is small and a dependency would add nothing but supply-chain risk.
 *
 *   Idempotency  The worker passes the notification id as the Idempotency-Key,
 *                so a retry after a timeout cannot send the same email twice.
 *   Failures     A rejection Resend will repeat (bad address, unverified
 *                domain, invalid key) is PERMANENT: the notification fails
 *                with a reason instead of retrying forever. Rate limiting,
 *                server errors, network errors and timeouts are TRANSIENT.
 *   Privacy      Error text never includes the response body, which can quote
 *                the recipient.
 *
 * Requires RESEND_API_KEY and a verified EMAIL_FROM; the environment check
 * refuses anything else.
 */

const ENDPOINT = 'https://api.resend.com/emails'

export interface ResendOptions {
  apiKey: string
  from: string
  timeoutMs?: number
  fetch?: typeof fetch
}

export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend'
  private readonly options: Required<Omit<ResendOptions, 'fetch'>> & { fetch: typeof fetch }

  constructor(options: ResendOptions) {
    this.options = { timeoutMs: 10_000, fetch: globalThis.fetch.bind(globalThis), ...options }
  }

  async send(message: EmailMessage): Promise<SendResult> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs)
    let response: Response
    try {
      response = await this.options.fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': message.idempotencyKey ?? newId(),
        },
        body: JSON.stringify({
          from: this.options.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          ...(message.replyTo ? { reply_to: message.replyTo } : {}),
        }),
        signal: controller.signal,
      })
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError'
      throw new Error(aborted ? 'Resend did not respond in time' : 'Resend could not be reached')
    } finally {
      clearTimeout(timer)
    }

    if (response.ok) {
      const body = (await response.json().catch(() => ({}))) as { id?: unknown }
      return {
        id: typeof body.id === 'string' ? body.id : newId(),
        delivered: true,
        provider: this.name,
      }
    }
    const kind = await errorName(response)
    if (response.status === 429 || response.status >= 500) {
      throw new Error(
        `Resend is temporarily unavailable (${response.status}${kind ? ` ${kind}` : ''})`,
      )
    }
    throw new PermanentEmailError(
      `Resend refused the message (${response.status}${kind ? ` ${kind}` : ''})`,
    )
  }
}

/** Resend's machine-readable error name only, never its message. */
async function errorName(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { name?: unknown }
    return typeof body.name === 'string' && /^[a-z_]{1,60}$/.test(body.name) ? body.name : ''
  } catch {
    return ''
  }
}
