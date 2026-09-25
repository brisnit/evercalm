import { newId } from '@/lib/ids'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from '../full-schema'

type SeedDb = NodePgDatabase<typeof schema>

/**
 * A named week for each demo location, and the staffing it asks for.
 *
 * Round 2's scheduling begins with a template, so the demo has to begin with
 * one too: a manager opening Schedule for the first time should be one tap
 * from a laid-out week, not looking at a wizard they have to finish before
 * anything happens.
 *
 * The staffing is what these two rooms actually need — a lunch and a dinner
 * server shift, one host, a bartender from four, and a kitchen that starts
 * before the floor does.
 */

interface Pattern {
  name: string
  role: string
  start: number
  end: number
  headcount: number
  days: number[]
}

const H = (hour: number, minute = 0) => hour * 60 + minute
const ALL = [1, 2, 3, 4, 5, 6]
const BUSY = [4, 5, 6]

const RIVERSIDE: Pattern[] = [
  // Sized to the crew this restaurant actually has: a full week is reachable,
  // and the two slots that stay open are the ones a real operator would be
  // short of - a bartender on the two nights Camille cannot work.
  { name: 'Server · lunch', role: 'server', start: H(11), end: H(16), headcount: 1, days: ALL },
  {
    name: 'Server · dinner',
    role: 'server',
    start: H(16),
    end: H(22, 30),
    headcount: 2,
    days: ALL,
  },
  { name: 'Host', role: 'host', start: H(16), end: H(22), headcount: 1, days: ALL },
  { name: 'Bartender', role: 'bartender', start: H(16), end: H(23), headcount: 1, days: ALL },
  { name: 'Busser', role: 'busser', start: H(17), end: H(23), headcount: 1, days: BUSY },
  { name: 'Prep', role: 'prep-cook', start: H(7), end: H(15), headcount: 1, days: ALL },
  { name: 'Sous', role: 'sous', start: H(10), end: H(18), headcount: 1, days: ALL },
  { name: 'Line · dinner', role: 'line-cook', start: H(15), end: H(23), headcount: 1, days: ALL },
]

const DOWNTOWN: Pattern[] = [
  {
    name: 'Server · dinner',
    role: 'server',
    start: H(16),
    end: H(22, 30),
    headcount: 1,
    days: ALL,
  },
  { name: 'Host', role: 'host', start: H(16, 30), end: H(22), headcount: 1, days: ALL },
  { name: 'Bartender', role: 'bartender', start: H(16), end: H(23), headcount: 1, days: BUSY },
]

const SALON: Pattern[] = [
  {
    name: 'Floor · morning',
    role: 'stylist',
    start: H(9),
    end: H(14),
    headcount: 2,
    days: [2, 3, 4, 5, 6],
  },
  {
    name: 'Floor · afternoon',
    role: 'stylist',
    start: H(14),
    end: H(19),
    headcount: 2,
    days: [2, 3, 4, 5, 6],
  },
  {
    name: 'Front desk',
    role: 'coordinator',
    start: H(9),
    end: H(18),
    headcount: 1,
    days: [2, 3, 4, 5, 6],
  },
]

export async function seedSlottedTemplates(
  db: SeedDb,
  ctx: {
    organizationId: string
    slug: string
    locationIds: Map<string, string>
    jobRoleIds: Map<string, string>
    employmentIds: Map<string, string>
  },
) {
  const plan: { location: string; name: string; openDays: number[]; patterns: Pattern[] }[] =
    ctx.slug === 'harbor-vine'
      ? [
          { location: 'riverside', name: 'Standard week', openDays: ALL, patterns: RIVERSIDE },
          { location: 'downtown', name: 'Standard week', openDays: ALL, patterns: DOWNTOWN },
        ]
      : [
          { location: 'pearl', name: 'Standard week', openDays: [2, 3, 4, 5, 6], patterns: SALON },
          { location: 'bench', name: 'Standard week', openDays: [2, 3, 4, 5, 6], patterns: SALON },
        ]

  const createdBy = ctx.employmentIds.get('owner') ?? null
  let templates = 0
  let patterns = 0

  for (const entry of plan) {
    const locationId = ctx.locationIds.get(entry.location)
    if (!locationId) continue

    const templateId = newId()
    await db.insert(schema.scheduleTemplates).values({
      id: templateId,
      organizationId: ctx.organizationId,
      locationId,
      name: entry.name,
      isDefault: true,
      openDays: entry.openDays,
      createdByEmploymentId: createdBy,
    })
    templates += 1

    for (const pattern of entry.patterns) {
      const length = pattern.end - pattern.start
      await db.insert(schema.shiftTemplates).values({
        id: newId(),
        organizationId: ctx.organizationId,
        locationId,
        templateSetId: templateId,
        name: pattern.name,
        jobRoleId: ctx.jobRoleIds.get(pattern.role) ?? null,
        startMinute: pattern.start,
        endMinute: pattern.end,
        // The default meal rule: 30 minutes on anything over five hours.
        breakMinutes: length >= 300 ? 30 : 0,
        daysOfWeek: pattern.days.filter((d) => entry.openDays.includes(d)),
        headcount: pattern.headcount,
        createdByEmploymentId: createdBy,
      })
      patterns += 1
    }
  }

  return { templates, patterns }
}
