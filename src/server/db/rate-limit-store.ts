import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { appDb } from './client'
import type { Db } from './types'

/*
 * APPLICATION RATE LIMITS, IN THE DATABASE.
 *
 * On a serverless host every instance has its own memory, so an in-memory
 * counter limits almost nothing. This one is shared: a single atomic upsert
 * per call either starts a new fixed window or increments the current one,
 * and concurrent calls from any number of instances count exactly once each.
 *
 * Keys are hashed, so the table holds no ids or addresses.
 */

export interface RateLimit {
  max: number
  windowSeconds: number
}

const hashKey = (scope: string, key: string) =>
  `${scope}:${createHash('sha256').update(key).digest('hex').slice(0, 40)}`

/** Counts this call and returns the count in the current window. */
export async function consumeRateLimit(
  scope: string,
  key: string,
  limit: RateLimit,
  db?: Db,
): Promise<number> {
  const id = hashKey(scope, key)
  const window = Math.max(1, Math.floor(limit.windowSeconds))
  const result = await (db ?? appDb()).execute<{ count: number }>(sql`
    insert into app_rate_limits (key, window_started_at, count)
    values (${id}, now(), 1)
    on conflict (key) do update set
      count = case
        when app_rate_limits.window_started_at <= now() - make_interval(secs => ${window}) then 1
        else app_rate_limits.count + 1 end,
      window_started_at = case
        when app_rate_limits.window_started_at <= now() - make_interval(secs => ${window}) then now()
        else app_rate_limits.window_started_at end
    returning count
  `)
  return Number(result.rows[0]?.count ?? 1)
}

/** Old windows are useless; the worker clears them. */
export async function pruneRateLimits(db?: Db): Promise<number> {
  const result = await (db ?? appDb()).execute(
    sql`delete from app_rate_limits where window_started_at < now() - interval '1 day'`,
  )
  return result.rowCount ?? 0
}
