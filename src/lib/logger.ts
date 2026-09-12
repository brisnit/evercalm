import pino from 'pino'
import { getEnv } from './env'

/**
 * Structured logging with explicit redaction.
 *
 * Employee PII must never reach logs. The redaction list below is
 * enforcement, not documentation - add to it whenever a sensitive field
 * is introduced.
 */
const REDACTED_PATHS = [
  'password',
  '*.password',
  'passwordHash',
  '*.passwordHash',
  'token',
  '*.token',
  'tokenHash',
  '*.tokenHash',
  'secret',
  '*.secret',
  'authorization',
  'req.headers.authorization',
  'req.headers.cookie',
  'email',
  '*.email',
  'phone',
  '*.phone',
  'emergencyContactName',
  '*.emergencyContactName',
  'emergencyContactPhone',
  '*.emergencyContactPhone',
  'dateOfBirth',
  '*.dateOfBirth',
  'addressLine1',
  '*.addressLine1',
]

export const logger = pino({
  level: getEnv().LOG_LEVEL,
  redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
  base: { service: 'evercalm' },
})

export type Logger = typeof logger
