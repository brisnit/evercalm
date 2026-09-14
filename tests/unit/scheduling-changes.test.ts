import { describe, expect, it } from 'vitest'
import {
  diffPublication,
  hasUnpublishedChange,
  type PublishableShift,
} from '@/modules/scheduling/changes'

/**
 * Who a publication notifies, and about what.
 *
 * The promise: a republication tells exactly the people whose shifts changed,
 * and tells them precisely what changed. Everyone else hears nothing.
 */

const at = (iso: string) => new Date(iso)

function shift(overrides: Partial<PublishableShift> = {}): PublishableShift {
  const base: PublishableShift = {
    id: 'shift-1',
    status: 'active',
    assigneeEmploymentId: 'sam',
    isOpen: false,
    startsAt: at('2026-09-15T23:00:00Z'),
    endsAt: at('2026-09-16T05:00:00Z'),
    breakMinutes: 30,
    jobRoleId: 'server',
    stationId: null,
    notes: '',
    // Published exactly as it is now.
    publishedAt: at('2026-09-10T00:00:00Z'),
    publishedStatus: 'active',
    publishedAssigneeEmploymentId: 'sam',
    publishedIsOpen: false,
    publishedStartsAt: at('2026-09-15T23:00:00Z'),
    publishedEndsAt: at('2026-09-16T05:00:00Z'),
    publishedBreakMinutes: 30,
    publishedJobRoleId: 'server',
    publishedStationId: null,
    publishedNotes: '',
  }
  return { ...base, ...overrides }
}

const neverPublished: Partial<PublishableShift> = {
  publishedAt: null,
  publishedStatus: null,
  publishedAssigneeEmploymentId: null,
  publishedIsOpen: null,
  publishedStartsAt: null,
  publishedEndsAt: null,
  publishedBreakMinutes: null,
  publishedJobRoleId: null,
  publishedStationId: null,
  publishedNotes: null,
}

const kinds = (diff: ReturnType<typeof diffPublication>) =>
  Object.fromEntries(
    [...diff.people.entries()].map(([who, changes]) => [who, changes.map((c) => c.kind)]),
  )

describe('first publication', () => {
  it('tells each assigned person about their shifts, and nobody else', () => {
    const diff = diffPublication([
      shift({ ...neverPublished }),
      shift({ ...neverPublished, id: 'shift-2', assigneeEmploymentId: 'camille' }),
      shift({ ...neverPublished, id: 'shift-3', assigneeEmploymentId: null }),
    ])
    expect(kinds(diff)).toEqual({ sam: ['added'], camille: ['added'] })
    expect(diff.changedShiftCount).toBe(3)
  })

  it('announces a shift offered as open', () => {
    const diff = diffPublication([
      shift({ ...neverPublished, assigneeEmploymentId: null, isOpen: true }),
    ])
    expect(diff.newlyOpenShiftIds).toEqual(['shift-1'])
    expect(diff.people.size).toBe(0)
  })
})

describe('republication', () => {
  it('says nothing when nothing changed', () => {
    const diff = diffPublication([
      shift(),
      shift({
        id: 'shift-2',
        assigneeEmploymentId: 'camille',
        publishedAssigneeEmploymentId: 'camille',
      }),
    ])
    expect(diff.people.size).toBe(0)
    expect(diff.changedShiftCount).toBe(0)
    expect(hasUnpublishedChange(shift())).toBe(false)
  })

  it('tells only the person whose time moved, with the old and new times', () => {
    const moved = shift({ startsAt: at('2026-09-16T00:00:00Z') })
    const diff = diffPublication([
      moved,
      shift({
        id: 'other',
        assigneeEmploymentId: 'camille',
        publishedAssigneeEmploymentId: 'camille',
      }),
    ])
    expect(kinds(diff)).toEqual({ sam: ['changed'] })
    const [change] = diff.people.get('sam')!
    expect(change!.previousStartsAt?.toISOString()).toBe('2026-09-15T23:00:00.000Z')
    expect(change!.startsAt.toISOString()).toBe('2026-09-16T00:00:00.000Z')
  })

  it('tells both people when a shift is reassigned', () => {
    const diff = diffPublication([shift({ assigneeEmploymentId: 'camille' })])
    expect(kinds(diff)).toEqual({ sam: ['removed'], camille: ['added'] })
  })

  it('tells the person when their shift is cancelled or unassigned', () => {
    expect(kinds(diffPublication([shift({ status: 'cancelled' })]))).toEqual({ sam: ['removed'] })
    expect(kinds(diffPublication([shift({ assigneeEmploymentId: null })]))).toEqual({
      sam: ['removed'],
    })
  })

  it('counts a role, station, break or note change as a change for the same person', () => {
    for (const edit of [
      { jobRoleId: 'host' },
      { stationId: 'bar' },
      { breakMinutes: 0 },
      { notes: 'Cover the patio' },
    ]) {
      expect(kinds(diffPublication([shift(edit)]))).toEqual({ sam: ['changed'] })
    }
  })

  it('does not re-announce a shift that was already open', () => {
    const open = shift({
      assigneeEmploymentId: null,
      publishedAssigneeEmploymentId: null,
      isOpen: true,
      publishedIsOpen: true,
    })
    expect(diffPublication([open]).newlyOpenShiftIds).toEqual([])
  })

  it('ignores a cancelled shift that was already published as cancelled', () => {
    const gone = shift({ status: 'cancelled', publishedStatus: 'cancelled' })
    expect(hasUnpublishedChange(gone)).toBe(false)
    expect(diffPublication([gone]).people.size).toBe(0)
  })
})
