import { mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import net from 'node:net'
import EmbeddedPostgres from 'embedded-postgres'
import pg from 'pg'

/**
 * Real PostgreSQL for integration tests - no Docker, no mock.
 *
 * Row-Level Security, role attributes, and composite foreign keys cannot be
 * meaningfully tested against an in-memory fake, and those are exactly what
 * Slice 1 has to prove. embedded-postgres downloads genuine PostgreSQL
 * binaries, so CI and a laptop run identical checks.
 *
 * The two-role model mirrors production:
 *   evercalm_migrator  owns the schema. NOSUPERUSER, NOBYPASSRLS. It is
 *                      exempt from the policies only because it owns the
 *                      tables, which is the intended mechanism.
 *   evercalm_app       the runtime role. Owns nothing, bypasses nothing.
 */

export const MIGRATOR_ROLE = 'evercalm_migrator'
export const APP_ROLE = 'evercalm_app'
const MIGRATOR_PASSWORD = 'test_migrator_pw'
const APP_PASSWORD = 'test_app_pw'
const TEST_DATABASE = 'evercalm_test'

const ROOT = path.resolve(import.meta.dirname, '../..')
const DATA_DIR = path.join(ROOT, '.tmp/pgdata')
const INFO_FILE = path.join(ROOT, '.tmp/test-db.json')

export interface TestDatabaseInfo {
  port: number
  appUrl: string
  migrationUrl: string
  superuserUrl: string
}

async function findFreePort(start: number): Promise<number> {
  for (let port = start; port < start + 40; port += 1) {
    const free = await new Promise<boolean>((resolve) => {
      const server = net.createServer()
      server.once('error', () => resolve(false))
      server.once('listening', () => server.close(() => resolve(true)))
      server.listen(port, '127.0.0.1')
    })
    if (free) return port
  }
  throw new Error('No free port available for the test database')
}

let instance: EmbeddedPostgres | undefined

export async function startTestPostgres(): Promise<TestDatabaseInfo> {
  await rm(DATA_DIR, { recursive: true, force: true })
  await mkdir(path.dirname(DATA_DIR), { recursive: true })

  const port = await findFreePort(55_432)

  instance = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: 'postgres',
    // secret-scan-allow: bootstrap superuser for an ephemeral test cluster
    password: 'postgres',
    port,
    persistent: false,
    onLog: () => {
      /* PostgreSQL is chatty on startup; silence it in test output. */
    },
  })

  await instance.initialise()
  await instance.start()

  const superuserUrl = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`
  const admin = new pg.Client({ connectionString: superuserUrl })
  await admin.connect()
  try {
    // Neither role may bypass RLS. The migrator's exemption comes solely from
    // owning the tables, which is the mechanism we actually want to test.
    await admin.query(
      `create role ${MIGRATOR_ROLE} login password '${MIGRATOR_PASSWORD}' nosuperuser nobypassrls nocreatedb nocreaterole`,
    )
    await admin.query(
      `create role ${APP_ROLE} login password '${APP_PASSWORD}' nosuperuser nobypassrls nocreatedb nocreaterole`,
    )
    await admin.query(`create database ${TEST_DATABASE} owner ${MIGRATOR_ROLE}`)
  } finally {
    await admin.end()
  }

  const info: TestDatabaseInfo = {
    port,
    // secret-scan-allow: ephemeral test database, destroyed after the run
    appUrl: `postgres://${APP_ROLE}:${APP_PASSWORD}@127.0.0.1:${port}/${TEST_DATABASE}`,
    // secret-scan-allow: ephemeral test database, destroyed after the run
    migrationUrl: `postgres://${MIGRATOR_ROLE}:${MIGRATOR_PASSWORD}@127.0.0.1:${port}/${TEST_DATABASE}`,
    superuserUrl: `postgres://postgres:postgres@127.0.0.1:${port}/${TEST_DATABASE}`,
  }

  await mkdir(path.dirname(INFO_FILE), { recursive: true })
  await writeFile(INFO_FILE, JSON.stringify(info), 'utf8')
  return info
}

export async function stopTestPostgres(): Promise<void> {
  await instance?.stop()
  instance = undefined
  await rm(DATA_DIR, { recursive: true, force: true })
  await rm(INFO_FILE, { force: true })
}

/** Read connection details written by global setup. */
export async function testDatabaseInfo(): Promise<TestDatabaseInfo> {
  const raw = await readFile(INFO_FILE, 'utf8')
  return JSON.parse(raw) as TestDatabaseInfo
}
