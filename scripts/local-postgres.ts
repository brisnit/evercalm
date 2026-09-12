/**
 * Local development PostgreSQL - no Docker required.
 *
 * Creates the same two-role model production uses:
 *   evercalm_migrator  owns the schema, runs migrations and seeds.
 *                      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE.
 *                      Its RLS exemption comes solely from owning the tables.
 *   evercalm_app       the runtime role, with the same four privileges denied.
 *
 * The database itself is created by the bootstrap superuser with
 * `OWNER evercalm_migrator`, so the migrator never needs CREATEDB.
 *
 * Usage:
 *   npm run db:local           start (stays in the foreground)
 *   npm run db:local:status    is it running, and on which PID
 *   npm run db:local:stop      deterministic shutdown via pg_ctl
 *   npm run db:local:reset     stop, erase the cluster, re-initialise
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import EmbeddedPostgres from 'embedded-postgres'
import pg from 'pg'

const ROOT = path.resolve(import.meta.dirname, '..')
const DATA_DIR = path.join(ROOT, '.pgdata')
const PID_FILE = path.join(DATA_DIR, 'postmaster.pid')
const PORT = Number(process.env.LOCAL_PG_PORT ?? 55_500)
const DB = 'evercalm_dev'

const APP_ROLE = 'evercalm_app'
const APP_PASSWORD = 'evercalm_app_dev'
const MIGRATOR_ROLE = 'evercalm_migrator'
const MIGRATOR_PASSWORD = 'evercalm_migrator_dev'

/** Locate pg_ctl from the platform-specific embedded-postgres package. */
function pgCtlPath(): string {
  const platformPackage = `@embedded-postgres/${process.platform}-${process.arch}`
  const binary = path.join(
    ROOT,
    'node_modules',
    platformPackage,
    'native',
    'bin',
    process.platform === 'win32' ? 'pg_ctl.exe' : 'pg_ctl',
  )
  if (!existsSync(binary)) {
    throw new Error(
      `Could not find pg_ctl at ${binary}. Is ${platformPackage} installed for this platform?`,
    )
  }
  return binary
}

function runningPid(): number | null {
  if (!existsSync(PID_FILE)) return null
  const pid = Number(readFileSync(PID_FILE, 'utf8').split('\n')[0])
  if (!Number.isInteger(pid) || pid <= 0) return null
  try {
    // Signal 0 tests for existence without touching the process.
    process.kill(pid, 0)
    return pid
  } catch {
    return null
  }
}

/**
 * Deterministic shutdown: pg_ctl asks THIS cluster's postmaster to stop, by
 * data directory. It never signals an unrelated process, which a broad
 * `pkill postgres` would.
 */
function stop(): void {
  const pid = runningPid()
  if (pid === null) {
    console.log('Local PostgreSQL is not running.')
    return
  }
  execFileSync(pgCtlPath(), ['-D', DATA_DIR, '-m', 'fast', '-w', 'stop'], { stdio: 'inherit' })
  console.log(`Stopped local PostgreSQL (was PID ${pid}).`)
}

/** Returns 0 when running, 3 when stopped - so scripts can branch on it. */
function status(): number {
  const pid = runningPid()
  if (pid === null) {
    console.log(`Local PostgreSQL: stopped${existsSync(DATA_DIR) ? ' (cluster exists)' : ''}`)
    return 3
  }
  console.log(`Local PostgreSQL: running on port ${PORT} (PID ${pid}), data dir ${DATA_DIR}`)
  return 0
}

function reset(): void {
  if (runningPid() !== null) stop()
  rmSync(DATA_DIR, { recursive: true, force: true })
  console.log(
    'Erased the local cluster. Run `npm run db:local` to re-create it, then migrate and seed.',
  )
}

async function start(): Promise<void> {
  if (runningPid() !== null) {
    console.log(`Local PostgreSQL is already running on port ${PORT}. Nothing to do.`)
    return
  }

  const fresh = !existsSync(DATA_DIR)
  const instance = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: 'postgres',
    // secret-scan-allow: bootstrap superuser for a throwaway localhost cluster
    password: 'postgres',
    port: PORT,
    persistent: true,
  })

  if (fresh) await instance.initialise()
  await instance.start()

  if (fresh) {
    const admin = new pg.Client({
      connectionString: `postgres://postgres:postgres@127.0.0.1:${PORT}/postgres`,
    })
    await admin.connect()
    try {
      // Neither role may create databases, create roles, or bypass RLS.
      await admin.query(
        `create role ${MIGRATOR_ROLE} login password '${MIGRATOR_PASSWORD}' nosuperuser nobypassrls nocreatedb nocreaterole`,
      )
      await admin.query(
        `create role ${APP_ROLE} login password '${APP_PASSWORD}' nosuperuser nobypassrls nocreatedb nocreaterole`,
      )
      // The superuser creates the database and hands ownership to the migrator.
      await admin.query(`create database ${DB} owner ${MIGRATOR_ROLE}`)
    } finally {
      await admin.end()
    }
    console.log('Created roles and database.')
  }

  console.log(`
PostgreSQL ${fresh ? 'initialised and ' : ''}running on port ${PORT}.

  DATABASE_URL=postgres://${APP_ROLE}:${APP_PASSWORD}@127.0.0.1:${PORT}/${DB}   secret-scan-allow: printed local dev connection string, localhost only
  MIGRATION_DATABASE_URL=postgres://${MIGRATOR_ROLE}:${MIGRATOR_PASSWORD}@127.0.0.1:${PORT}/${DB}   secret-scan-allow: printed local dev connection string, localhost only

Next:  npm run db:migrate && npm run db:seed
Stop:  npm run db:local:stop
`)

  const shutdown = () => {
    void instance.stop().finally(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  // Watchdog: if the postmaster goes away - because `npm run db:local:stop`
  // was used, or it crashed - this supervisor has nothing left to supervise
  // and must exit rather than linger as an idle background process.
  const watchdog = setInterval(() => {
    if (runningPid() === null) {
      console.log('PostgreSQL has stopped. Exiting.')
      clearInterval(watchdog)
      process.exit(0)
    }
  }, 1_000)
}

async function dispatch(command: string): Promise<number> {
  switch (command) {
    case 'start':
      await start()
      return 0
    case 'stop':
      stop()
      return 0
    case 'status':
      return status()
    case 'reset':
      reset()
      return 0
    default:
      console.error(`Unknown command "${command}". Use start, stop, status, or reset.`)
      return 1
  }
}

const exitCode = await dispatch(process.argv[2] ?? 'start')
if (exitCode !== 0) {
  // Flush stdout before exiting, or the message can be lost.
  await new Promise<void>((resolve) => {
    process.stdout.write('', () => resolve())
  })
  process.exit(exitCode)
}
