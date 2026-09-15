import { readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { EXPECTED_LATEST_MIGRATION, readiness, workerState } from '@/server/readiness'

/** The deploy gate: environment, isolation, migrations; the worker is reported. */

describe('readiness', () => {
  it('expects the newest migration in the repository', () => {
    const files = readdirSync(path.resolve(import.meta.dirname, '../../drizzle'))
      .filter((f) => f.endsWith('.sql'))
      .sort()
    expect(EXPECTED_LATEST_MIGRATION).toBe(files.at(-1))
  })

  it('refuses traffic until environment, isolation and migrations are right', () => {
    const now = new Date('2026-09-14T12:00:00Z')
    const base = {
      envValid: true,
      rlsEnforced: true,
      latestMigration: EXPECTED_LATEST_MIGRATION,
      workerLastFinishedAt: null,
      now,
    }
    expect(readiness(base).ready).toBe(true)
    expect(readiness({ ...base, envValid: false }).ready).toBe(false)
    expect(readiness({ ...base, rlsEnforced: false }).ready).toBe(false)
    expect(readiness({ ...base, latestMigration: '0018_operations.sql' }).ready).toBe(false)
    // A stopped worker is reported, not a reason to stop serving pages.
    expect(readiness(base).checks.worker).toBe('not_running')
  })

  it('describes the worker by how long ago it last ran', () => {
    const now = new Date('2026-09-14T12:00:00Z')
    expect(workerState(new Date(now.getTime() - 60_000), now)).toBe('running')
    expect(workerState(new Date(now.getTime() - 20 * 60_000), now)).toBe('delayed')
    expect(workerState(new Date(now.getTime() - 3 * 3_600_000), now)).toBe('not_running')
  })
})
