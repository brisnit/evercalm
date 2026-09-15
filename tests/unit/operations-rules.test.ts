import { describe, expect, it } from 'vitest'
import {
  bucketItems,
  describeTiming,
  dueAt,
  handoffCategoryLabel,
  interventionFor,
  itemState,
  progressOf,
  progressState,
  shiftPhase,
  templateApplies,
  type ItemFacts,
} from '@/modules/operations/rules'

/**
 * Shift operations rules: when a task is due, whether a template applies,
 * what state a task is in and where it belongs. Pure, so pinned here.
 */

// Bar close at Riverside: 17:00 to 01:00 Los Angeles time, crossing midnight.
const barClose = {
  startsAt: new Date('2026-09-16T00:00:00Z'), // 17:00 PDT on the 15th
  endsAt: new Date('2026-09-16T08:00:00Z'), // 01:00 PDT on the 16th
}

const item = (over: Partial<ItemFacts> = {}): ItemFacts => ({
  id: 'i',
  status: 'pending',
  dueAt: new Date('2026-09-16T01:00:00Z'),
  position: 0,
  required: true,
  responseType: 'check',
  kind: 'side_work',
  returnedNote: '',
  ...over,
})

describe('timing', () => {
  it('counts from the start or the end of the published shift, across midnight', () => {
    expect(dueAt({ timingAnchor: 'shift_start', offsetMinutes: -30 }, barClose).toISOString()).toBe(
      '2026-09-15T23:30:00.000Z',
    )
    // Fifteen minutes before a 01:00 close is 00:45 the next local day.
    expect(dueAt({ timingAnchor: 'shift_end', offsetMinutes: -15 }, barClose).toISOString()).toBe(
      '2026-09-16T07:45:00.000Z',
    )
  })

  it('describes timing in plain words', () => {
    expect(describeTiming('shift_start', -30)).toBe('30 min before the shift starts')
    expect(describeTiming('shift_end', 0)).toBe('When the shift ends')
    expect(describeTiming('shift_start', 90)).toBe('1 hr 30 min after the shift starts')
    expect(describeTiming('shift_end', -60)).toBe('1 hr before the shift ends')
  })

  it('knows where an overnight shift is, including after midnight', () => {
    expect(shiftPhase(barClose, new Date('2026-09-15T20:00:00Z'))).toBe('upcoming')
    expect(shiftPhase(barClose, new Date('2026-09-15T23:30:00Z'))).toBe('before')
    expect(shiftPhase(barClose, new Date('2026-09-16T07:30:00Z'))).toBe('during') // 00:30 local
    expect(shiftPhase(barClose, new Date('2026-09-16T08:00:00Z'))).toBe('after')
  })
})

describe('which templates apply to a shift', () => {
  const shift = { locationId: 'riverside', jobRoleId: 'bartender', stationId: 'bar' }

  it('applies an untargeted template everywhere', () => {
    expect(templateApplies({ locationIds: [], jobRoleIds: [], stationIds: [] }, shift)).toBe(true)
  })

  it('narrows by each dimension', () => {
    expect(
      templateApplies({ locationIds: ['downtown'], jobRoleIds: [], stationIds: [] }, shift),
    ).toBe(false)
    expect(
      templateApplies(
        { locationIds: ['riverside'], jobRoleIds: ['bartender'], stationIds: [] },
        shift,
      ),
    ).toBe(true)
    expect(
      templateApplies({ locationIds: [], jobRoleIds: ['server'], stationIds: [] }, shift),
    ).toBe(false)
    expect(templateApplies({ locationIds: [], jobRoleIds: [], stationIds: ['grill'] }, shift)).toBe(
      false,
    )
  })

  it('never matches a role or station the shift does not have', () => {
    const openShift = { locationId: 'riverside', jobRoleId: null, stationId: null }
    expect(
      templateApplies({ locationIds: [], jobRoleIds: ['bartender'], stationIds: [] }, openShift),
    ).toBe(false)
    expect(
      templateApplies({ locationIds: [], jobRoleIds: [], stationIds: ['bar'] }, openShift),
    ).toBe(false)
  })
})

describe('task states', () => {
  const before = new Date('2026-09-16T00:00:00Z')

  it('moves from to do, to due soon, to overdue as time passes', () => {
    const task = item({ dueAt: new Date('2026-09-16T01:00:00Z') })
    expect(itemState(task, before)).toBe('not_started')
    expect(itemState(task, new Date('2026-09-16T00:40:00Z'))).toBe('due_soon')
    expect(itemState(task, new Date('2026-09-16T01:00:00Z'))).toBe('overdue')
  })

  it('reports what people did, and what a manager sent back', () => {
    expect(itemState(item({ status: 'blocked' }), before)).toBe('blocked')
    expect(itemState(item({ status: 'skipped' }), before)).toBe('skipped')
    expect(itemState(item({ status: 'awaiting_verification' }), before)).toBe('waiting')
    expect(itemState(item({ status: 'done' }), before)).toBe('done')
    expect(itemState(item({ returnedNote: 'Wipe the rail again.' }), before)).toBe('returned')
  })

  it('keeps finished work finished when a shift is cancelled, and retires the rest', () => {
    expect(itemState(item({ status: 'done' }), before, true)).toBe('done')
    expect(itemState(item(), before, true)).toBe('cancelled')
    expect(itemState(item({ status: 'awaiting_verification' }), before, true)).toBe('cancelled')
  })
})

describe('the workspace', () => {
  const now = new Date('2026-09-15T23:00:00Z') // 16:00 local, an hour before the bar opens

  it('puts each task in exactly one place, attention first', () => {
    const tasks = [
      item({ id: 'uniform', kind: 'pre_shift', dueAt: new Date('2026-09-15T23:45:00Z') }),
      item({ id: 'ice', kind: 'station_setup', dueAt: new Date('2026-09-15T23:20:00Z') }),
      item({ id: 'garnish', kind: 'side_work', dueAt: new Date('2026-09-16T03:00:00Z') }),
      item({ id: 'kegs', status: 'blocked', dueAt: new Date('2026-09-16T04:00:00Z') }),
      item({
        id: 'till',
        status: 'awaiting_verification',
        dueAt: new Date('2026-09-16T07:45:00Z'),
      }),
      item({
        id: 'note',
        responseType: 'handoff',
        kind: 'handoff',
        dueAt: new Date('2026-09-16T07:50:00Z'),
      }),
      item({ id: 'mats', status: 'done', dueAt: new Date('2026-09-15T23:30:00Z') }),
      item({ id: 'lemons', status: 'skipped', dueAt: new Date('2026-09-16T02:00:00Z') }),
    ]
    const b = bucketItems(tasks, barClose, now)
    const ids = (list: ItemFacts[]) => list.map((i) => i.id)
    expect(ids(b.now)).toEqual(['ice', 'kegs'])
    expect(ids(b.beforeShift)).toEqual(['uniform'])
    expect(ids(b.remaining)).toEqual(['garnish'])
    expect(ids(b.waiting)).toEqual(['till'])
    expect(ids(b.handoff)).toEqual(['note'])
    expect(ids(b.done)).toEqual(['mats', 'lemons'])
    const all = (Object.values(b) as ItemFacts[][]).flat()
    expect(all).toHaveLength(tasks.length)
    expect(new Set(all.map((i) => i.id)).size).toBe(tasks.length)
  })
})

describe('progress', () => {
  const now = new Date('2026-09-16T02:00:00Z')

  it('reaches 100% only when nothing is left, waiting included', () => {
    const p = progressOf(
      [
        item({ status: 'done' }),
        item({ status: 'skipped', required: false }),
        item({ status: 'awaiting_verification' }),
      ],
      now,
    )
    expect(p).toMatchObject({ total: 3, done: 1, skipped: 1, waiting: 1, percent: 66 })
    expect(progressState(p)).toBe('in_progress')
    expect(
      progressState(
        progressOf([item({ status: 'done' }), item({ status: 'skipped', required: false })], now),
      ),
    ).toBe('complete')
  })

  it('flags what needs a manager: blocked, overdue, sent back, required work skipped', () => {
    const p = progressOf(
      [
        item({ status: 'blocked' }),
        item({ dueAt: new Date('2026-09-16T01:00:00Z') }),
        item({ status: 'skipped', required: true }),
      ],
      now,
    )
    expect(p).toMatchObject({ blocked: 1, overdue: 1, requiredSkipped: 1 })
    expect(progressState(p)).toBe('needs_attention')
    expect(interventionFor(item({ status: 'skipped', required: false }), now)).toBeNull()
    expect(interventionFor(item({ status: 'skipped', required: true }), now)).toBe(
      'skipped_required',
    )
    expect(interventionFor(item({ status: 'awaiting_verification' }), now)).toBe('waiting')
  })

  it('starts not started', () => {
    expect(
      progressState(progressOf([item({ dueAt: new Date('2026-09-16T05:00:00Z') })], now)),
    ).toBe('not_started')
  })
})

describe('handoff vocabulary', () => {
  it('says guest in a restaurant and client in a salon', () => {
    expect(handoffCategoryLabel('guest', 'restaurant')).toBe('Guest issue')
    expect(handoffCategoryLabel('guest', 'salon')).toBe('Client issue')
    expect(handoffCategoryLabel('follow_up', 'salon')).toBe('Follow-up')
  })
})
