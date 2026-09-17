/**
 * The EverCalm background worker.
 *
 * Publishes scheduled announcements, expires old ones, sends automatic
 * acknowledgement reminders, and delivers queued notifications. See
 * src/server/jobs/worker.ts for how it stays durable and idempotent, and
 * docs/architecture.md ("Background work") for operating it.
 *
 * Usage:
 *   npm run worker           run continuously (foreground; Ctrl+C to stop)
 *   npm run worker:once      run a single tick and exit - the shape a
 *                            production scheduler would invoke
 *   npm run worker:status    is it running, when did it last tick
 *   npm run worker:stop      ask the running worker to stop gracefully
 *
 * `npm run dev` starts this alongside the web server.
 *
 * Environment:
 *   WORKER_INTERVAL_MS   time between ticks (default 15000)
 */
import { config } from 'dotenv'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { TickReport } from '../src/server/jobs/worker'

config({ path: '.env.local', quiet: true })
config({ quiet: true })

const ROOT = path.resolve(import.meta.dirname, '..')

/**
 * One status file per database, so the browser suite's worker and a
 * developer's own worker do not mistake each other for themselves: they run
 * side by side against evercalm_e2e and evercalm_dev, and a single shared
 * file made the second one exit as "already running".
 */
function statusFile(): string {
  const database = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? '').pathname.replace(/^\//, '')
    } catch {
      return ''
    }
  })()
  const suffix = database && database !== 'evercalm_dev' ? `-${database}` : ''
  return path.join(ROOT, '.tmp', `worker${suffix}.json`)
}

const STATUS_FILE = statusFile()
const DEFAULT_INTERVAL_MS = 15_000

interface WorkerStatus {
  pid: number
  startedAt: string
  intervalMs: number
  lastTickAt: string | null
  lastTick: {
    organizations: number
    published: number
    expired: number
    reminded: number
    sent: number
    retrying: number
    failed: number
    errors: number
  } | null
}

function readStatus(): WorkerStatus | null {
  if (!existsSync(STATUS_FILE)) return null
  try {
    return JSON.parse(readFileSync(STATUS_FILE, 'utf8')) as WorkerStatus
  } catch {
    return null
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function writeStatus(status: WorkerStatus): void {
  mkdirSync(path.dirname(STATUS_FILE), { recursive: true })
  writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2), 'utf8')
}

function intervalMs(): number {
  const raw = Number(process.env.WORKER_INTERVAL_MS ?? DEFAULT_INTERVAL_MS)
  return Number.isFinite(raw) && raw >= 250 ? raw : DEFAULT_INTERVAL_MS
}

async function loadRuntime() {
  // Imported lazily so `status` and `stop` work without a database or a
  // valid environment.
  const db = await import('../src/server/db')
  const jobs = await import('../src/server/jobs/worker')
  // Same boot guard as the web server: never run with a role that can
  // bypass Row-Level Security.
  await db.assertRuntimeRoleIsSafe()
  return { db, jobs }
}

function summarise(report: TickReport) {
  return {
    organizations: report.organizations,
    published: report.published + report.expiredBeforePublish,
    expired: report.expired,
    reminded: report.reminded,
    sent: report.sent,
    retrying: report.retrying,
    failed: report.failed + report.scheduleFailures,
    errors: report.errors.length,
  }
}

async function once(): Promise<number> {
  const { db, jobs } = await loadRuntime()
  try {
    const report = await jobs.runWorkerTick()
    console.log(JSON.stringify(summarise(report)))
    for (const error of report.errors) {
      console.error(
        `[worker] ${error.step} failed for ${error.organizationId ?? 'discovery'}: ${error.message}`,
      )
    }
    return report.errors.length > 0 ? 1 : 0
  } finally {
    await db.closePools()
  }
}

async function start(): Promise<number> {
  const existing = readStatus()
  if (existing && existing.pid !== process.pid && isAlive(existing.pid)) {
    console.log(`The worker is already running (PID ${existing.pid}). Nothing to do.`)
    return 0
  }

  const { db, jobs } = await loadRuntime()
  const interval = intervalMs()
  const status: WorkerStatus = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    intervalMs: interval,
    lastTickAt: null,
    lastTick: null,
  }
  writeStatus(status)
  console.log(`[worker] running every ${interval}ms (PID ${process.pid}). Ctrl+C to stop.`)

  const handle = jobs.startWorker({
    intervalMs: interval,
    onTick: (report) => {
      status.lastTickAt = report.finishedAt.toISOString()
      status.lastTick = summarise(report)
      writeStatus(status)
      if (jobs.tickDidWork(report)) {
        console.log(`[worker] ${JSON.stringify(status.lastTick)}`)
      }
      for (const error of report.errors) {
        console.error(
          `[worker] ${error.step} failed for ${error.organizationId ?? 'discovery'}: ${error.message}`,
        )
      }
    },
  })

  let stopping = false
  const shutdown = (signal: string) => {
    if (stopping) return
    stopping = true
    console.log(`[worker] ${signal} received; finishing the current tick.`)
    void handle
      .stop()
      .then(() => db.closePools())
      .finally(() => {
        const current = readStatus()
        if (current?.pid === process.pid) rmSync(STATUS_FILE, { force: true })
        console.log('[worker] stopped.')
        process.exit(0)
      })
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  // Stay alive until a signal arrives.
  await new Promise<never>(() => {})
  return 0
}

/** Returns 0 when running and ticking, 3 otherwise - so scripts can branch on it. */
function statusCommand(): number {
  const status = readStatus()
  if (!status || !isAlive(status.pid)) {
    console.log('Worker: stopped')
    return 3
  }
  const last = status.lastTickAt ? new Date(status.lastTickAt) : null
  const age = last ? Math.round((Date.now() - last.getTime()) / 1000) : null
  const stale = age === null || age * 1000 > status.intervalMs * 4 + 60_000
  console.log(
    `Worker: running (PID ${status.pid}), every ${status.intervalMs}ms, ` +
      (age === null ? 'no tick completed yet' : `last tick ${age}s ago`) +
      (stale ? ' - WARNING: ticks look stalled' : ''),
  )
  if (status.lastTick) console.log(`Last tick: ${JSON.stringify(status.lastTick)}`)
  return stale && age !== null ? 1 : 0
}

async function stopCommand(): Promise<number> {
  const status = readStatus()
  if (!status || !isAlive(status.pid)) {
    console.log('The worker is not running.')
    rmSync(STATUS_FILE, { force: true })
    return 0
  }
  process.kill(status.pid, 'SIGTERM')
  for (let i = 0; i < 100 && isAlive(status.pid); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (isAlive(status.pid)) {
    console.error(`The worker (PID ${status.pid}) did not stop within 10 seconds.`)
    return 1
  }
  console.log(`Stopped the worker (was PID ${status.pid}).`)
  return 0
}

async function dispatch(command: string): Promise<number> {
  switch (command) {
    case 'start':
      return start()
    case 'once':
      return once()
    case 'status':
      return statusCommand()
    case 'stop':
      return stopCommand()
    default:
      console.error(`Unknown command "${command}". Use start, once, status, or stop.`)
      return 1
  }
}

const exitCode = await dispatch(process.argv[2] ?? 'start')
await new Promise<void>((resolve) => {
  process.stdout.write('', () => resolve())
})
process.exit(exitCode)
