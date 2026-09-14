import { and, eq } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { newId } from '@/lib/ids'
import { addCalendarDays } from '@/lib/dates'
import {
  isoWeekday,
  localDateOf,
  parseTimeOfDay,
  shiftInstants,
  weekDates,
  weekStartOf,
} from '@/modules/scheduling/time'
import * as schema from '../full-schema'

/*
 * SCHEDULING DEMO DATA.
 *
 * Three weeks per location, all relative to the day the seed runs, in each
 * location's own timezone:
 *
 *   this week       published - what people are working now
 *   next week       published, then changed: an open shift with a pending
 *                   claim, a swap waiting on someone, and one edit a manager
 *                   has made but not yet published
 *   the week after  a draft with real conflicts to resolve - approved time
 *                   off under an assignment (blocks publishing), declared
 *                   unavailability and pending time off (warnings), gaps
 *
 * The restaurant and salon use the same tables and the same code. Only the
 * rows differ: templates named "Bar close" and "Colour bar", stations called
 * Grill and Chair 2. Nothing in the scheduling module knows which is which.
 */

type SeedDb = NodePgDatabase<typeof schema>

/** ISO weekdays. */
const TUE_TO_SUN = [2, 3, 4, 5, 6, 7]
const TUE_TO_SAT = [2, 3, 4, 5, 6]
const WED_TO_SUN = [3, 4, 5, 6, 7]
const WED_TO_SAT = [3, 4, 5, 6]

interface TemplateSeed {
  key: string
  location: string
  name: string
  jobRole?: string
  station?: string
  start: string
  end: string
  breakMinutes?: number
  days: number[]
  headcount?: number
  notes?: string
}

/** person key per slot, per ISO weekday. `'open'` offers it; undefined leaves it empty. */
type SlotPlan = Partial<Record<number, (string | null)[]>>

interface WeekSeed {
  location: string
  /** 0 = this week. */
  offset: number
  publish: boolean
  publishedBy: string
  plan: Record<string, SlotPlan>
  /** Edits made after publication and not yet republished. */
  laterEdits?: { template: string; weekday: number; slot?: number; start: string; end: string }[]
}

interface SchedulingSeed {
  templates: TemplateSeed[]
  weeks: WeekSeed[]
  availability: {
    person: string
    weekday: number
    start: string
    end: string
    preference: string
  }[]
  timeOff: {
    person: string
    location: string
    week: number
    weekday: number
    days?: number
    reason: string
    note?: string
    status: 'pending' | 'approved' | 'denied'
    decidedBy?: string
    decisionNote?: string
  }[]
  claims: {
    location: string
    week: number
    template: string
    weekday: number
    slot?: number
    person: string
    note?: string
  }[]
  swaps: {
    location: string
    week: number
    template: string
    weekday: number
    slot?: number
    requester: string
    recipient: string
    kind: 'giveaway' | 'trade'
    recipientTemplate?: string
    recipientWeekday?: number
    recipientSlot?: number
    status: 'pending_recipient' | 'pending_manager'
    note?: string
  }[]
}

const every = (days: number[], people: (string | null)[]): SlotPlan =>
  Object.fromEntries(days.map((d) => [d, people]))

// ---------------------------------------------------------------------------
// Harbor & Vine - a restaurant
// ---------------------------------------------------------------------------

const riversideWeek = (offset: number): Record<string, SlotPlan> => ({
  'r-lunch': { ...every([2, 3, 4, 5, 6], ['lead-riverside']), 7: ['new-server'] },
  'r-dinner': {
    ...every([2, 3, 4, 5, 6], ['server', 'new-server']),
    7: ['server', offset === 0 ? null : 'open'],
  },
  'r-bar': every(WED_TO_SUN, ['bartender']),
  'r-line': every(TUE_TO_SUN, ['new-cook']),
  'r-prep': every(TUE_TO_SAT, ['prep']),
})

const HARBOR: SchedulingSeed = {
  templates: [
    {
      key: 'r-lunch',
      location: 'riverside',
      name: 'Lunch service',
      jobRole: 'server',
      station: 'Server Station A',
      start: '10:30',
      end: '15:00',
      days: TUE_TO_SUN,
    },
    {
      key: 'r-dinner',
      location: 'riverside',
      name: 'Dinner service',
      jobRole: 'server',
      station: 'Server Station B',
      start: '16:00',
      end: '22:30',
      breakMinutes: 30,
      days: TUE_TO_SUN,
      headcount: 2,
    },
    {
      key: 'r-bar',
      location: 'riverside',
      name: 'Bar close',
      jobRole: 'bartender',
      station: 'Bar',
      start: '17:00',
      end: '01:00',
      breakMinutes: 30,
      days: WED_TO_SUN,
      notes: 'Last call 12:30. Count the till with the closing manager.',
    },
    {
      key: 'r-line',
      location: 'riverside',
      name: 'Grill · dinner',
      jobRole: 'line-cook',
      station: 'Grill',
      start: '15:00',
      end: '23:00',
      breakMinutes: 30,
      days: TUE_TO_SUN,
    },
    {
      key: 'r-prep',
      location: 'riverside',
      name: 'Morning prep',
      jobRole: 'prep-cook',
      start: '08:00',
      end: '14:00',
      days: TUE_TO_SAT,
    },
    {
      key: 'd-host',
      location: 'downtown',
      name: 'Host stand · dinner',
      jobRole: 'host',
      station: 'Host Stand',
      start: '16:30',
      end: '22:00',
      days: WED_TO_SUN,
    },
    {
      key: 'd-server',
      location: 'downtown',
      name: 'Dinner service',
      jobRole: 'server',
      station: 'Server Station',
      start: '16:00',
      end: '22:30',
      breakMinutes: 30,
      days: WED_TO_SUN,
    },
  ],
  weeks: [
    {
      location: 'riverside',
      offset: 0,
      publish: true,
      publishedBy: 'gm-riverside',
      plan: riversideWeek(0),
    },
    {
      location: 'riverside',
      offset: 1,
      publish: true,
      publishedBy: 'scheduler',
      plan: riversideWeek(1),
      laterEdits: [{ template: 'r-dinner', weekday: 5, slot: 0, start: '17:00', end: '22:30' }],
    },
    {
      location: 'riverside',
      offset: 2,
      publish: false,
      publishedBy: 'scheduler',
      plan: {
        'r-bar': { 6: ['bartender'] },
        'r-lunch': { 3: ['server'] },
        'r-dinner': { 2: ['server', null], 4: ['new-server', null] },
        'r-line': every(TUE_TO_SUN, ['new-cook']),
      },
    },
    {
      location: 'downtown',
      offset: 0,
      publish: true,
      publishedBy: 'gm-downtown',
      plan: {
        'd-host': every(WED_TO_SUN, ['host']),
        'd-server': every(WED_TO_SAT, ['dual-server']),
      },
    },
    {
      location: 'downtown',
      offset: 1,
      publish: true,
      publishedBy: 'gm-downtown',
      plan: {
        'd-host': every(WED_TO_SUN, ['host']),
        'd-server': { ...every(WED_TO_SAT, ['dual-server']), 7: ['open'] },
      },
    },
  ],
  availability: [
    { person: 'server', weekday: 1, start: '00:00', end: '24:00', preference: 'unavailable' },
    { person: 'server', weekday: 3, start: '00:00', end: '12:00', preference: 'unavailable' },
    { person: 'new-server', weekday: 5, start: '16:00', end: '24:00', preference: 'preferred' },
    { person: 'new-server', weekday: 6, start: '16:00', end: '24:00', preference: 'preferred' },
    {
      person: 'lead-riverside',
      weekday: 7,
      start: '00:00',
      end: '24:00',
      preference: 'unavailable',
    },
  ],
  timeOff: [
    {
      person: 'bartender',
      location: 'riverside',
      week: 2,
      weekday: 5,
      days: 3,
      reason: 'vacation',
      note: 'Sister’s wedding in Portland.',
      status: 'approved',
      decidedBy: 'gm-riverside',
      decisionNote: 'Approved - enjoy the wedding.',
    },
    {
      person: 'server',
      location: 'riverside',
      week: 2,
      weekday: 2,
      reason: 'family',
      status: 'pending',
    },
    {
      person: 'new-cook',
      location: 'riverside',
      week: 1,
      weekday: 2,
      reason: 'personal',
      status: 'denied',
      decidedBy: 'scheduler',
      decisionNote: 'We are two cooks short that night. Could another date work?',
    },
  ],
  claims: [
    {
      location: 'riverside',
      week: 1,
      template: 'r-dinner',
      weekday: 7,
      slot: 1,
      person: 'lead-riverside',
      note: 'Happy to pick this up.',
    },
    { location: 'downtown', week: 1, template: 'd-server', weekday: 7, person: 'host' },
  ],
  swaps: [
    {
      location: 'riverside',
      week: 1,
      template: 'r-dinner',
      weekday: 4,
      slot: 0,
      requester: 'server',
      recipient: 'lead-riverside',
      kind: 'giveaway',
      status: 'pending_manager',
      note: 'Exam that evening - Jordan said yes.',
    },
  ],
}

// ---------------------------------------------------------------------------
// Lumen Salon & Spa - a salon with a second site in another timezone
// ---------------------------------------------------------------------------

const pearlWeek = (offset: number): Record<string, SlotPlan> => ({
  'p-chair1': { ...every([2, 3, 4, 5], ['stylist-senior']), 6: [offset === 0 ? null : 'open'] },
  'p-chair2': every([3, 4, 5, 6], ['new-stylist']),
  'p-colour': every(WED_TO_SAT, ['colourist']),
  'p-desk-am': every(TUE_TO_SAT, ['coordinator']),
  'p-desk-pm': every(TUE_TO_SAT, ['dual-assistant']),
  'p-treatment': every(TUE_TO_SAT, ['esthetician']),
  'p-assist': every(TUE_TO_SAT, ['apprentice']),
})

const LUMEN: SchedulingSeed = {
  templates: [
    {
      key: 'p-chair1',
      location: 'pearl',
      name: 'Stylist · chair 1',
      jobRole: 'stylist',
      station: 'Chair 1',
      start: '09:00',
      end: '17:00',
      breakMinutes: 30,
      days: TUE_TO_SAT,
    },
    {
      key: 'p-chair2',
      location: 'pearl',
      name: 'Stylist · chair 2',
      jobRole: 'stylist',
      station: 'Chair 2',
      start: '10:00',
      end: '18:00',
      breakMinutes: 30,
      days: TUE_TO_SAT,
    },
    {
      key: 'p-colour',
      location: 'pearl',
      name: 'Colour bar',
      jobRole: 'colourist',
      station: 'Colour Bar',
      start: '11:00',
      end: '19:00',
      breakMinutes: 30,
      days: WED_TO_SAT,
      notes: 'Check the toner stock before the first appointment.',
    },
    {
      key: 'p-desk-am',
      location: 'pearl',
      name: 'Front desk · opening',
      jobRole: 'coordinator',
      station: 'Front Desk',
      start: '08:30',
      end: '14:30',
      days: TUE_TO_SAT,
    },
    {
      key: 'p-desk-pm',
      location: 'pearl',
      name: 'Front desk · closing',
      jobRole: 'coordinator',
      station: 'Front Desk',
      start: '14:00',
      end: '20:00',
      breakMinutes: 15,
      days: TUE_TO_SAT,
    },
    {
      key: 'p-treatment',
      location: 'pearl',
      name: 'Treatment room',
      jobRole: 'esthetician',
      station: 'Treatment Room 1',
      start: '10:00',
      end: '18:00',
      breakMinutes: 30,
      days: TUE_TO_SAT,
    },
    {
      key: 'p-assist',
      location: 'pearl',
      name: 'Shampoo & assist',
      jobRole: 'apprentice',
      station: 'Shampoo Area',
      start: '09:00',
      end: '15:00',
      days: TUE_TO_SAT,
    },
    {
      key: 'b-massage',
      location: 'bench',
      name: 'Massage · treatment room',
      jobRole: 'massage',
      station: 'Treatment Room',
      start: '10:00',
      end: '18:00',
      breakMinutes: 30,
      days: WED_TO_SAT,
    },
  ],
  weeks: [
    { location: 'pearl', offset: 0, publish: true, publishedBy: 'gm-pearl', plan: pearlWeek(0) },
    {
      location: 'pearl',
      offset: 1,
      publish: true,
      publishedBy: 'gm-pearl',
      plan: pearlWeek(1),
      laterEdits: [{ template: 'p-treatment', weekday: 3, start: '11:00', end: '19:00' }],
    },
    {
      location: 'pearl',
      offset: 2,
      publish: false,
      publishedBy: 'gm-pearl',
      plan: {
        'p-colour': { 4: ['colourist'] },
        'p-treatment': { 3: ['esthetician'] },
        'p-desk-am': every(TUE_TO_SAT, ['coordinator']),
      },
    },
    {
      location: 'bench',
      offset: 0,
      publish: true,
      publishedBy: 'gm-bench',
      plan: { 'b-massage': every(WED_TO_SAT, ['massage']) },
    },
    {
      location: 'bench',
      offset: 1,
      publish: true,
      publishedBy: 'gm-bench',
      plan: { 'b-massage': every(WED_TO_SAT, ['massage']) },
    },
  ],
  availability: [
    { person: 'apprentice', weekday: 7, start: '00:00', end: '24:00', preference: 'unavailable' },
    { person: 'coordinator', weekday: 2, start: '08:00', end: '15:00', preference: 'preferred' },
    { person: 'new-stylist', weekday: 2, start: '00:00', end: '24:00', preference: 'available' },
  ],
  timeOff: [
    {
      person: 'colourist',
      location: 'pearl',
      week: 2,
      weekday: 4,
      reason: 'personal',
      status: 'approved',
      decidedBy: 'gm-pearl',
    },
    {
      person: 'esthetician',
      location: 'pearl',
      week: 2,
      weekday: 3,
      reason: 'family',
      status: 'pending',
      note: 'School event.',
    },
  ],
  claims: [
    {
      location: 'pearl',
      week: 1,
      template: 'p-chair1',
      weekday: 6,
      person: 'apprentice',
      note: 'I can take walk-ins under supervision.',
    },
  ],
  swaps: [
    {
      location: 'pearl',
      week: 1,
      template: 'p-chair1',
      weekday: 2,
      requester: 'stylist-senior',
      recipient: 'new-stylist',
      kind: 'trade',
      recipientTemplate: 'p-chair2',
      recipientWeekday: 6,
      status: 'pending_recipient',
      note: 'Could we trade Tuesday for your Saturday?',
    },
  ],
}

const SEEDS: Record<string, SchedulingSeed> = { 'harbor-vine': HARBOR, 'lumen-salon': LUMEN }

// ---------------------------------------------------------------------------

export interface SchedulingSeedContext {
  organizationId: string
  slug: string
  locationIds: Map<string, string>
  locationTimeZones: Map<string, string>
  jobRoleIds: Map<string, string>
  employmentIds: Map<string, string>
  systemEvent: (
    action: string,
    summary: string,
    extra?: Partial<typeof schema.auditEvents.$inferInsert>,
  ) => void
}

export async function seedScheduling(
  db: SeedDb,
  ctx: SchedulingSeedContext,
  now = new Date(),
): Promise<{ shifts: number }> {
  const seed = SEEDS[ctx.slug]
  if (!seed) return { shifts: 0 }
  const { organizationId } = ctx
  const person = (key: string) => {
    const id = ctx.employmentIds.get(key)
    if (!id) throw new Error(`Scheduling seed: unknown person ${key} in ${ctx.slug}`)
    return id
  }
  const tzOf = (location: string) => ctx.locationTimeZones.get(location)!
  const weekStartFor = (location: string, offset: number) =>
    addCalendarDays(weekStartOf(localDateOf(now, tzOf(location))), 7 * offset)

  // --- templates ------------------------------------------------------------
  const templateIds = new Map<string, string>()
  const templateStationIds = new Map<string, string | null>()
  for (const t of seed.templates) {
    const locationId = ctx.locationIds.get(t.location)!
    const [station] = t.station
      ? await db
          .select({ id: schema.stations.id })
          .from(schema.stations)
          .where(
            and(
              eq(schema.stations.organizationId, organizationId),
              eq(schema.stations.locationId, locationId),
              eq(schema.stations.name, t.station),
            ),
          )
      : []
    const id = newId()
    templateIds.set(t.key, id)
    templateStationIds.set(t.key, station?.id ?? null)
    await db.insert(schema.shiftTemplates).values({
      id,
      organizationId,
      locationId,
      name: t.name,
      jobRoleId: t.jobRole ? (ctx.jobRoleIds.get(t.jobRole) ?? null) : null,
      stationId: station?.id ?? null,
      startMinute: parseTimeOfDay(t.start)!,
      endMinute: parseTimeOfDay(t.end)!,
      breakMinutes: t.breakMinutes ?? 0,
      daysOfWeek: t.days,
      headcount: t.headcount ?? 1,
      notes: t.notes ?? '',
    })
  }

  // --- weeks ------------------------------------------------------------------
  /** `${location}|${week}|${template}|${weekday}|${slot}` -> shift id and version */
  const shiftIndex = new Map<string, string>()
  let shiftCount = 0

  for (const week of seed.weeks) {
    const locationId = ctx.locationIds.get(week.location)!
    const timeZone = tzOf(week.location)
    const weekStart = weekStartFor(week.location, week.offset)
    const scheduleId = newId()
    const publishedAt = new Date(now.getTime() - (week.offset === 0 ? 3 : 1) * 86_400_000)
    const publisher = person(week.publishedBy)

    await db.insert(schema.schedules).values({
      id: scheduleId,
      organizationId,
      locationId,
      weekStart,
      status: week.publish ? 'published' : 'draft',
      publishedVersion: week.publish ? 1 : 0,
      publishedAt: week.publish ? publishedAt : null,
      publishedByEmploymentId: week.publish ? publisher : null,
      hasUnpublishedChanges: (week.laterEdits?.length ?? 0) > 0,
    })

    const notified = new Set<string>()
    for (const t of seed.templates.filter((x) => x.location === week.location)) {
      const plan = week.plan[t.key] ?? {}
      for (const date of weekDates(weekStart)) {
        const weekday = isoWeekday(date)
        if (!t.days.includes(weekday)) continue
        const times = shiftInstants(
          date,
          parseTimeOfDay(t.start)!,
          parseTimeOfDay(t.end)!,
          timeZone,
        )
        if (!times.ok) continue
        for (let slot = 0; slot < (t.headcount ?? 1); slot += 1) {
          const who = plan[weekday]?.[slot]
          const open = who === 'open'
          const assignee = who && !open ? person(who) : null
          const id = newId()
          shiftIndex.set(`${week.location}|${week.offset}|${t.key}|${weekday}|${slot}`, id)
          const live = {
            startsAt: times.startsAt,
            endsAt: times.endsAt,
            breakMinutes: t.breakMinutes ?? 0,
            jobRoleId: t.jobRole ? (ctx.jobRoleIds.get(t.jobRole) ?? null) : null,
            notes: t.notes ?? '',
          }
          const stationId = templateStationIds.get(t.key) ?? null

          await db.insert(schema.shifts).values({
            id,
            organizationId,
            scheduleId,
            locationId,
            templateId: templateIds.get(t.key)!,
            ...live,
            stationId,
            assigneeEmploymentId: assignee,
            isOpen: open,
            createdByEmploymentId: publisher,
            updatedByEmploymentId: publisher,
            ...(week.publish
              ? {
                  publishedAt,
                  publishedStartsAt: live.startsAt,
                  publishedEndsAt: live.endsAt,
                  publishedBreakMinutes: live.breakMinutes,
                  publishedJobRoleId: live.jobRoleId,
                  publishedStationId: stationId,
                  publishedNotes: live.notes,
                  publishedAssigneeEmploymentId: assignee,
                  publishedIsOpen: open,
                  publishedStatus: 'active',
                }
              : {}),
          })
          shiftCount += 1
          if (week.publish && assignee) notified.add(assignee)
        }
      }
    }

    for (const edit of week.laterEdits ?? []) {
      const id = shiftIndex.get(
        `${week.location}|${week.offset}|${edit.template}|${edit.weekday}|${edit.slot ?? 0}`,
      )
      const date = weekDates(weekStart).find((d) => isoWeekday(d) === edit.weekday)!
      const times = shiftInstants(
        date,
        parseTimeOfDay(edit.start)!,
        parseTimeOfDay(edit.end)!,
        timeZone,
      )
      if (!id || !times.ok) continue
      await db
        .update(schema.shifts)
        .set({ startsAt: times.startsAt, endsAt: times.endsAt, version: 2, updatedAt: now })
        .where(eq(schema.shifts.id, id))
    }

    if (week.publish) {
      const location = [...ctx.locationIds.entries()].find(([, v]) => v === locationId)![0]
      ctx.systemEvent(
        'schedule.published',
        `Published the ${location} schedule for the week of ${weekStart}`,
        {
          subjectType: 'schedule',
          subjectId: scheduleId,
          locationId,
          metadata: { version: 1, notifiedPeople: notified.size },
        },
      )
      for (const employmentId of notified) {
        await db.insert(schema.notifications).values({
          id: newId(),
          organizationId,
          employmentId,
          category: 'schedule',
          channel: 'in_app',
          subjectType: 'schedule',
          subjectId: scheduleId,
          title: `Your schedule for the week of ${weekStart} is ready`,
          preview: 'Open your schedule to see your shifts.',
          href: `/my/schedule?week=${weekStart}`,
          status: 'sent',
          sentAt: publishedAt,
          idempotencyKey: `schedule:${scheduleId}:${employmentId}:in_app:v1`,
          createdAt: publishedAt,
        })
      }
    }
  }

  // --- availability ---------------------------------------------------------
  for (const a of seed.availability) {
    await db.insert(schema.availabilityRules).values({
      id: newId(),
      organizationId,
      employmentId: person(a.person),
      weekday: a.weekday,
      startMinute: a.start === '24:00' ? 1440 : parseTimeOfDay(a.start)!,
      endMinute: a.end === '24:00' ? 1440 : parseTimeOfDay(a.end)!,
      preference: a.preference,
    })
  }

  // --- time off -------------------------------------------------------------
  for (const t of seed.timeOff) {
    const weekStart = weekStartFor(t.location, t.week)
    const startsOn = weekDates(weekStart).find((d) => isoWeekday(d) === t.weekday)!
    const endsOn = addCalendarDays(startsOn, (t.days ?? 1) - 1)
    const id = newId()
    const decided = t.status !== 'pending'
    await db.insert(schema.timeOffRequests).values({
      id,
      organizationId,
      employmentId: person(t.person),
      startsOn,
      endsOn,
      reason: t.reason,
      note: t.note ?? '',
      status: t.status,
      decidedByEmploymentId: decided && t.decidedBy ? person(t.decidedBy) : null,
      decidedAt: decided ? new Date(now.getTime() - 86_400_000) : null,
      decisionNote: t.decisionNote ?? '',
      createdAt: new Date(now.getTime() - 4 * 86_400_000),
    })
    ctx.systemEvent(
      `time_off.${t.status === 'pending' ? 'requested' : t.status}`,
      `Time off ${t.status}: ${startsOn}${endsOn !== startsOn ? ` to ${endsOn}` : ''}`,
      {
        subjectType: 'time_off',
        subjectId: id,
      },
    )
  }

  // --- open shift claims ----------------------------------------------------
  for (const c of seed.claims) {
    const shiftId = shiftIndex.get(
      `${c.location}|${c.week}|${c.template}|${c.weekday}|${c.slot ?? 0}`,
    )
    if (!shiftId) continue
    await db.insert(schema.openShiftClaims).values({
      id: newId(),
      organizationId,
      shiftId,
      employmentId: person(c.person),
      note: c.note ?? '',
    })
  }

  // --- swaps ------------------------------------------------------------------
  for (const s of seed.swaps) {
    const shiftId = shiftIndex.get(
      `${s.location}|${s.week}|${s.template}|${s.weekday}|${s.slot ?? 0}`,
    )
    const recipientShiftId = s.recipientTemplate
      ? shiftIndex.get(
          `${s.location}|${s.week}|${s.recipientTemplate}|${s.recipientWeekday}|${s.recipientSlot ?? 0}`,
        )
      : undefined
    if (!shiftId || (s.kind === 'trade' && !recipientShiftId)) continue
    const id = newId()
    await db.insert(schema.shiftSwapRequests).values({
      id,
      organizationId,
      kind: s.kind,
      shiftId,
      shiftVersion: 1,
      requesterEmploymentId: person(s.requester),
      recipientEmploymentId: person(s.recipient),
      recipientShiftId: recipientShiftId ?? null,
      recipientShiftVersion: recipientShiftId ? 1 : null,
      status: s.status,
      note: s.note ?? '',
      recipientRespondedAt:
        s.status === 'pending_manager' ? new Date(now.getTime() - 3_600_000) : null,
    })
    ctx.systemEvent('shift_swap.requested', `Requested a shift ${s.kind}`, {
      subjectType: 'shift_swap',
      subjectId: id,
    })
  }

  return { shifts: shiftCount }
}
