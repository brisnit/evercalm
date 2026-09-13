import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { config } from 'dotenv'
import pg from 'pg'

/**
 * Direct database access for browser tests - for the two things a browser
 * cannot do: move time, and look underneath the page.
 *
 * Uses the local development database the dev server is running against
 * (the same one `db:refresh` reseeds before each run). Never used to perform
 * an action the test is meant to prove; only to set the clock and to verify.
 */

config({ path: '.env.local', quiet: true })
config({ quiet: true })

let pool: pg.Pool | undefined

function db(): pg.Pool {
  const url = process.env.MIGRATION_DATABASE_URL
  if (!url) throw new Error('MIGRATION_DATABASE_URL is not set; browser tests need .env.local')
  pool ??= new pg.Pool({ connectionString: url, max: 2 })
  return pool
}

export async function closeDb(): Promise<void> {
  await pool?.end()
  pool = undefined
}

export async function announcementIdByTitle(title: string): Promise<string> {
  const { rows } = await db().query<{ id: string }>(
    `select a.id from announcements a
       join announcement_revisions r on r.id = a.current_revision_id
      where r.title = $1`,
    [title],
  )
  if (rows.length !== 1) throw new Error(`Expected one announcement titled "${title}"`)
  return rows[0]!.id
}

/** A datetime-local value N minutes from now, in the organization's timezone. */
export async function wallClockFromNow(organizationSlug: string, minutes: number): Promise<string> {
  const { rows } = await db().query<{ value: string }>(
    `select to_char((now() + make_interval(mins => $2)) at time zone timezone,
                    'YYYY-MM-DD"T"HH24:MI') as value
       from organizations where slug = $1`,
    [organizationSlug, minutes],
  )
  return rows[0]!.value
}

/**
 * Pretend the scheduled time has arrived. Only the clock moves: the RUNNING
 * worker still has to notice and publish it on its own.
 */
export async function makeScheduleDue(announcementId: string): Promise<void> {
  const { rowCount } = await db().query(
    `update announcements set publish_at = now() - interval '1 second'
      where id = $1 and status = 'scheduled'`,
    [announcementId],
  )
  if (rowCount !== 1) throw new Error('The announcement was not scheduled')
}

export async function deliveryState(announcementId: string) {
  const recipients = await db().query<{ n: string }>(
    'select count(*) as n from announcement_recipients where announcement_id = $1',
    [announcementId],
  )
  const notifications = await db().query<{ channel: string; status: string }>(
    `select channel, status from notifications
      where subject_id = $1 and idempotency_key like '%:initial'
      order by channel`,
    [announcementId],
  )
  return { recipients: Number(recipients.rows[0]!.n), notifications: notifications.rows }
}

/** Is `npm run worker` (started by `npm run dev`) alive? */
export function workerIsRunning(): boolean {
  const file = path.resolve(import.meta.dirname, '../../.tmp/worker.json')
  if (!existsSync(file)) return false
  try {
    const { pid } = JSON.parse(readFileSync(file, 'utf8')) as { pid: number }
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
