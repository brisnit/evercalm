/**
 * Local development: the web server AND the background worker, together.
 *
 * Without the worker, scheduled announcements never publish, nothing
 * expires, and notifications stay queued - so `npm run dev` runs both. Each
 * process's output is prefixed. If either exits, the other is stopped, so a
 * crashed worker is noticed instead of silently leaving a half-working app.
 *
 * Usage:
 *   npm run dev        web + worker
 *   npm run dev:web    web server only (the worker can be run separately)
 */
import { spawn, type ChildProcess } from 'node:child_process'

const children: { name: string; child: ChildProcess }[] = []
let shuttingDown = false

function run(name: string, command: string, args: string[]): void {
  const child = spawn(command, args, {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const prefix = (stream: NodeJS.WriteStream) => (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n')) {
      if (line.trim()) stream.write(`[${name}] ${line}\n`)
    }
  }
  child.stdout?.on('data', prefix(process.stdout))
  child.stderr?.on('data', prefix(process.stderr))
  child.on('exit', (code, signal) => {
    if (!shuttingDown) {
      console.error(`[dev] ${name} exited (${signal ?? code}); stopping everything.`)
      shutdown(code ?? 1)
    }
  })
  children.push({ name, child })
}

function shutdown(exitCode: number): void {
  if (shuttingDown) return
  shuttingDown = true
  const alive = children.filter(({ child }) => child.exitCode === null && child.signalCode === null)
  if (alive.length === 0) process.exit(exitCode)
  let remaining = alive.length
  for (const { child } of alive) {
    child.once('exit', () => {
      remaining -= 1
      if (remaining === 0) process.exit(exitCode)
    })
    child.kill('SIGTERM')
  }
  // Last resort, so the launcher itself can never hang.
  setTimeout(() => process.exit(exitCode), 15_000).unref()
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

run('web', 'npx', ['next', 'dev'])
run('worker', 'npx', ['tsx', 'scripts/worker.ts', 'start'])
