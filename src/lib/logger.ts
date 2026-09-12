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

/**
 * Built lazily.
 *
 * Reading the environment at module scope would make merely IMPORTING anything
 * that logs fail when the environment is incomplete - which is exactly what
 * happened to a test that imported a service two levels away from any logging.
 * A module should not refuse to load because of configuration it has not used
 * yet.
 */
let instance: pino.Logger | undefined

export function getLogger(): pino.Logger {
  instance ??= pino({
    level: getEnv().LOG_LEVEL,
    redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
    base: { service: 'evercalm' },
  })
  return instance
}

export type Logger = pino.Logger
