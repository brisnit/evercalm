/*
 * WHERE THE STAKEHOLDER-DEMO COMMAND MAY RUN.
 *
 * Resetting the demo truncates every table and creates accounts. That must
 * never reach a customer's data, so three independent things have to agree
 * before it does anything:
 *
 *   1. EVERCALM_ENVIRONMENT=stakeholder-demo in the process running it;
 *   2. the connection's host is exactly DEMO_DATABASE_HOST, configured on
 *      purpose for the demo database;
 *   3. the database itself carries the demo marker, set once at setup with
 *      COMMENT ON DATABASE.
 *
 * A database marked for production is always refused, whatever else says.
 */

export const DEMO_DATABASE_MARKER = 'evercalm:stakeholder-demo'
export const PRODUCTION_DATABASE_MARKER = 'evercalm:production'

export class DemoGuardError extends Error {
  constructor(reason: string) {
    super(`Refusing to touch this database: ${reason}`)
    this.name = 'DemoGuardError'
  }
}

export function hostOf(connectionString: string): string {
  try {
    return new URL(connectionString).hostname.toLowerCase()
  } catch {
    throw new DemoGuardError('the connection string is not a valid URL.')
  }
}

/** Checks 1 and 2, before connecting. */
export function assertDemoConfiguration(input: {
  environment: string | undefined
  configuredHost: string | undefined
  connectionString: string
}): void {
  if (input.environment !== 'stakeholder-demo') {
    throw new DemoGuardError('EVERCALM_ENVIRONMENT is not "stakeholder-demo".')
  }
  if (!input.configuredHost) {
    throw new DemoGuardError('DEMO_DATABASE_HOST is not set.')
  }
  const host = hostOf(input.connectionString)
  // Neon's pooled and direct hosts differ only by "-pooler"; both are accepted.
  const normalise = (h: string) => h.toLowerCase().replace('-pooler.', '.')
  if (normalise(host) !== normalise(input.configuredHost)) {
    throw new DemoGuardError('the connection host is not DEMO_DATABASE_HOST.')
  }
}

/** Check 3, after connecting: the database's own marker. */
export function assertDemoMarker(comment: string | null | undefined): void {
  const marker = (comment ?? '').trim()
  if (marker.includes(PRODUCTION_DATABASE_MARKER)) {
    throw new DemoGuardError('the database is marked as production.')
  }
  if (marker !== DEMO_DATABASE_MARKER) {
    throw new DemoGuardError('the database is not marked as the stakeholder demo.')
  }
}
