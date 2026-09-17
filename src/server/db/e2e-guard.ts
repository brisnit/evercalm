import pg from 'pg'
import { DEMO_DATABASE_MARKER, PRODUCTION_DATABASE_MARKER } from './demo-guard'

/*
 * WHERE THE BROWSER SUITE MAY RUN.
 *
 * The browser suite TRUNCATES and reseeds its database on every run, so it
 * must only ever reach a database that exists for it. Two independent things
 * have to agree, and neither is advisory:
 *
 *   1. the database is named exactly evercalm_e2e - a connection string
 *      pointing anywhere else is refused before anything connects;
 *   2. the database itself carries the e2e marker, set once at setup with
 *      COMMENT ON DATABASE.
 *
 * A database marked as development, as the stakeholder demo, or as production
 * is refused by name and again by marker, and the message says which. This
 * exists because a developer's own database was reseeded by a test run once:
 * the connection string was inherited from the shell, and nothing checked it.
 */

export const E2E_DATABASE_NAME = 'evercalm_e2e'
export const E2E_DATABASE_MARKER = 'evercalm:e2e'
export const DEVELOPMENT_DATABASE_MARKER = 'evercalm:development'

/** Markers that name a database the browser suite must never touch. */
export const FORBIDDEN_MARKERS: Record<string, string> = {
  [DEVELOPMENT_DATABASE_MARKER]: 'a development database',
  [DEMO_DATABASE_MARKER]: 'the stakeholder demo',
  [PRODUCTION_DATABASE_MARKER]: 'production',
}

export class E2eGuardError extends Error {
  constructor(operation: string, reason: string) {
    super(`Refusing to ${operation}: ${reason}`)
    this.name = 'E2eGuardError'
  }
}

/** The database a connection string points at, without connecting. */
export function databaseNameOf(operation: string, connectionString: string | undefined): string {
  if (!connectionString) {
    throw new E2eGuardError(operation, 'no database connection string is set.')
  }
  let name: string
  try {
    name = decodeURIComponent(new URL(connectionString).pathname.replace(/^\//, ''))
  } catch {
    throw new E2eGuardError(operation, 'the database connection string is not a valid URL.')
  }
  if (!name) throw new E2eGuardError(operation, 'the connection string names no database.')
  return name
}

/** Check 1: the name, before connecting. */
export function assertE2eDatabaseName(
  operation: string,
  connectionString: string | undefined,
): void {
  const name = databaseNameOf(operation, connectionString)
  if (name !== E2E_DATABASE_NAME) {
    throw new E2eGuardError(
      operation,
      `"${name}" is not the browser-test database. The browser suite only runs ` +
        `against "${E2E_DATABASE_NAME}". Create it with "npm run db:e2e:setup" and ` +
        `run the suite with "npm run test:e2e".`,
    )
  }
}

/** Check 2: the database's own marker, after connecting. */
export function assertE2eMarker(operation: string, comment: string | null | undefined): void {
  const marker = (comment ?? '').trim()
  for (const [forbidden, what] of Object.entries(FORBIDDEN_MARKERS)) {
    if (marker.includes(forbidden)) {
      throw new E2eGuardError(operation, `the database is marked as ${what}.`)
    }
  }
  if (marker !== E2E_DATABASE_MARKER) {
    throw new E2eGuardError(
      operation,
      marker === ''
        ? `the database carries no marker. Only a database marked "${E2E_DATABASE_MARKER}" ` +
            `may be reset by the browser suite; "npm run db:e2e:setup" sets it.`
        : `the database is marked "${marker}", not "${E2E_DATABASE_MARKER}".`,
    )
  }
}

/** The database's COMMENT ON DATABASE value, or null when it has none. */
export async function readDatabaseMarker(connectionString: string): Promise<string | null> {
  const client = new pg.Client({
    connectionString,
    ssl: /\bsslmode=require\b/.test(connectionString) ? { rejectUnauthorized: true } : undefined,
  })
  await client.connect()
  try {
    const { rows } = await client.query<{ comment: string | null }>(
      `select shobj_description(oid, 'pg_database') as comment
         from pg_database where datname = current_database()`,
    )
    return rows[0]?.comment ?? null
  } finally {
    await client.end()
  }
}

/**
 * Both checks. Used by the browser suite's setup and by every command that
 * truncates and reseeds, so the name and the marker must agree before a single
 * row is deleted.
 */
export async function assertE2eDatabase(
  operation: string,
  connectionString: string | undefined,
  readMarker: (url: string) => Promise<string | null> = readDatabaseMarker,
): Promise<void> {
  assertE2eDatabaseName(operation, connectionString)
  assertE2eMarker(operation, await readMarker(connectionString!))
}
