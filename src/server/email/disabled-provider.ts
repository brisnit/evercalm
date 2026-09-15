import {
  PermanentEmailError,
  type EmailMessage,
  type EmailProvider,
  type SendResult,
} from './provider'

/**
 * EMAIL_PROVIDER=disabled: an explicit decision that this deployment sends no
 * email. Email notifications are not created at all; if anything still tries
 * to send, it fails permanently with a plain reason rather than pretending.
 */
export class DisabledEmailProvider implements EmailProvider {
  readonly name = 'disabled'

  send(_message: EmailMessage): Promise<SendResult> {
    return Promise.reject(new PermanentEmailError('Email is switched off for this deployment.'))
  }
}
