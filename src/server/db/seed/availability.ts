import { newId } from '@/lib/ids'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from '../full-schema'

type SeedDb = NodePgDatabase<typeof schema>

/**
 * Who can work when.
 *
 * Round 2's scheduling rests entirely on this: every slot the manager fills is
 * coloured by what the person said, and autofill can only look good if people
 * have actually said something. So the demo declares it the way a real crew
 * would - a student who cannot work Tuesday and Thursday daytimes, a sous chef
 * who wants mornings, a bartender who lives for Friday and Saturday nights.
 *
 * The three stored preferences map onto what a manager sees:
 *
 *   preferred     "Available"      can work, and would like to
 *   available     "Not preferred"  can work, would rather not
 *   unavailable   "Unavailable"    said no; a manager may still override,
 *                                  with a warning, and it is recorded
 *
 * Approved time off is not here at all. It is a different table and a hard
 * stop - see scheduleOverrides in the scheduling schema.
 */

const H = (hour: number) => hour * 60
const WEEK = [1, 2, 3, 4, 5, 6, 7]
const WEEKDAYS = [1, 2, 3, 4, 5]
const WEEKEND = [6, 7]

export interface Window {
  days: number[]
  from: number
  to: number
  preference: 'preferred' | 'available' | 'unavailable'
}

const HARBOR: Record<string, Window[]> = {
  'gm-riverside': [
    { days: WEEKDAYS, from: H(8), to: H(18), preference: 'preferred' },
    { days: WEEKEND, from: H(10), to: H(22), preference: 'available' },
  ],
  scheduler: [
    { days: [1, 2, 3, 4, 5], from: H(9), to: H(19), preference: 'preferred' },
    { days: [7], from: 0, to: H(24), preference: 'unavailable' },
  ],
  'lead-riverside': [
    { days: [2, 3, 4, 5, 6], from: H(14), to: H(23), preference: 'preferred' },
    { days: [1], from: H(8), to: H(16), preference: 'available' },
    { days: [7], from: 0, to: H(24), preference: 'unavailable' },
  ],
  sous: [
    { days: [1, 2, 3, 4, 5, 6], from: H(7), to: H(16), preference: 'preferred' },
    { days: [1, 2, 3, 4, 5, 6], from: H(16), to: H(23), preference: 'available' },
  ],
  server: [
    // Sam is at community college on Tuesday and Thursday daytimes.
    { days: [2, 4], from: H(8), to: H(15), preference: 'unavailable' },
    { days: [1, 3, 5, 6], from: H(15), to: H(23), preference: 'preferred' },
    { days: [7], from: H(10), to: H(20), preference: 'available' },
  ],
  bartender: [
    { days: [5, 6], from: H(16), to: H(24), preference: 'preferred' },
    { days: [3, 4], from: H(16), to: H(23), preference: 'available' },
    { days: [1, 2], from: 0, to: H(24), preference: 'unavailable' },
  ],
  host: [
    // Theo's bus does not get in before 4:15 on Tuesdays - see the demo's
    // direct messages, where he says exactly that to his manager.
    { days: [2], from: 0, to: H(16), preference: 'unavailable' },
    { days: [1, 2, 3, 4], from: H(16), to: H(22), preference: 'preferred' },
    { days: [5, 6], from: H(16), to: H(23), preference: 'available' },
  ],
  'new-server': [
    { days: [1, 2, 3, 4, 5], from: H(8), to: H(16), preference: 'preferred' },
    { days: WEEKEND, from: H(10), to: H(18), preference: 'available' },
  ],
  'new-cook': [
    { days: [1, 2, 3, 4, 5, 6], from: H(14), to: H(23), preference: 'preferred' },
    { days: [7], from: H(12), to: H(20), preference: 'available' },
  ],
  'new-busser': [
    { days: [5, 6, 7], from: H(16), to: H(23), preference: 'preferred' },
    { days: [1, 2, 3, 4], from: 0, to: H(24), preference: 'unavailable' },
  ],
  prep: [
    { days: [1, 2, 3, 4, 5], from: H(6), to: H(14), preference: 'preferred' },
    { days: [6], from: H(6), to: H(12), preference: 'available' },
    { days: [7], from: 0, to: H(24), preference: 'unavailable' },
  ],
  'dual-server': [
    { days: [3, 4, 5], from: H(16), to: H(23), preference: 'preferred' },
    { days: [1, 2, 6, 7], from: H(10), to: H(22), preference: 'available' },
  ],
  'gm-downtown': [{ days: [2, 3, 4, 5, 6], from: H(9), to: H(19), preference: 'preferred' }],
}

const LUMEN: Record<string, Window[]> = {
  'gm-pearl': [{ days: [2, 3, 4, 5, 6], from: H(9), to: H(18), preference: 'preferred' }],
  'gm-bench': [{ days: [2, 3, 4, 5, 6], from: H(9), to: H(18), preference: 'preferred' }],
  trainer: [
    { days: [2, 3, 4], from: H(9), to: H(17), preference: 'preferred' },
    { days: [5, 6], from: H(9), to: H(17), preference: 'available' },
  ],
  'stylist-senior': [
    { days: [3, 4, 5, 6], from: H(10), to: H(19), preference: 'preferred' },
    { days: [1, 2], from: 0, to: H(24), preference: 'unavailable' },
  ],
  colourist: [
    { days: [2, 3, 4, 5], from: H(10), to: H(18), preference: 'preferred' },
    { days: [6], from: H(9), to: H(17), preference: 'available' },
  ],
  esthetician: [
    { days: [3, 4, 5, 6], from: H(10), to: H(19), preference: 'preferred' },
    { days: [1, 2], from: 0, to: H(24), preference: 'unavailable' },
  ],
  massage: [
    { days: [2, 4, 6], from: H(11), to: H(19), preference: 'preferred' },
    { days: [3, 5], from: H(11), to: H(19), preference: 'available' },
  ],
  'new-stylist': [
    { days: [2, 3, 4, 5], from: H(10), to: H(18), preference: 'preferred' },
    { days: [6], from: H(9), to: H(17), preference: 'available' },
  ],
  apprentice: [
    { days: [4, 5, 6], from: H(9), to: H(17), preference: 'preferred' },
    { days: [2, 3], from: 0, to: H(24), preference: 'unavailable' },
  ],
  coordinator: [{ days: [2, 3, 4, 5, 6], from: H(9), to: H(18), preference: 'preferred' }],
}

/** The declared windows for one tenant, by person key. */
export function availabilityPlan(slug: string): Record<string, Window[]> {
  return slug === 'harbor-vine' ? HARBOR : LUMEN
}

export async function seedAvailability(
  db: SeedDb,
  ctx: {
    organizationId: string
    slug: string
    employmentIds: Map<string, string>
    /** Leave these people alone: they have already said something. */
    skip?: ReadonlySet<string>
  },
) {
  const plan = availabilityPlan(ctx.slug)
  let rules = 0

  for (const [key, windows] of Object.entries(plan)) {
    const employmentId = ctx.employmentIds.get(key)
    if (!employmentId) continue
    if (ctx.skip?.has(employmentId)) continue
    for (const window of windows) {
      for (const weekday of window.days) {
        await db.insert(schema.availabilityRules).values({
          id: newId(),
          organizationId: ctx.organizationId,
          employmentId,
          weekday,
          startMinute: window.from,
          // A window stored to midnight ends at the last minute of the day.
          endMinute: Math.min(window.to, 1440),
          preference: window.preference,
        })
        rules += 1
      }
    }
  }

  return { rules, week: WEEK.length }
}
