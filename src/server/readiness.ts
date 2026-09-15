/*
 * READINESS RULES - pure, so a deploy gate is unit-tested rather than trusted.
 */

/** The newest migration this build requires. A unit test keeps it in step with drizzle/. */
export const EXPECTED_LATEST_MIGRATION = '0020_production_pilot.sql'

export const WORKER_HEALTHY_MS = 5 * 60_000

export type WorkerState = 'running' | 'delayed' | 'not_running'

export function workerState(lastFinishedAt: Date | null, now: Date): WorkerState {
  if (!lastFinishedAt) return 'not_running'
  const age = now.getTime() - lastFinishedAt.getTime()
  if (age <= WORKER_HEALTHY_MS) return 'running'
  if (age <= 60 * 60_000) return 'delayed'
  return 'not_running'
}

export function readiness(input: {
  envValid: boolean
  rlsEnforced: boolean
  latestMigration: string | null
  workerLastFinishedAt: Date | null
  now: Date
}) {
  const migrationsCurrent = input.latestMigration === EXPECTED_LATEST_MIGRATION
  const worker = workerState(input.workerLastFinishedAt, input.now)
  return {
    ready: input.envValid && input.rlsEnforced && migrationsCurrent,
    checks: {
      environment: input.envValid ? 'ok' : 'invalid',
      isolation: input.rlsEnforced ? 'ok' : 'role can bypass row-level security',
      migrations: migrationsCurrent ? 'ok' : 'pending or unexpected',
      worker,
    },
  }
}
