/*
 * WHAT A PUBLICATION CHANGES, AND FOR WHOM.
 *
 * Pure. Compares each shift's live columns (what the manager has now) with
 * its published columns (what employees were last told) and says, per person:
 *
 *   added    they now have a shift they were not told about
 *   removed  a shift they were told about is gone, or is someone else's now
 *   changed  the same shift is still theirs, but its time, role, station,
 *            break or notes differ
 *
 * People with no difference are not in the result, which is what keeps a
 * republication from messaging the whole team about one person's change.
 */

export interface PublishableShift {
  id: string
  status: string
  assigneeEmploymentId: string | null
  isOpen: boolean
  startsAt: Date
  endsAt: Date
  breakMinutes: number
  jobRoleId: string | null
  stationId: string | null
  notes: string
  publishedAt: Date | null
  publishedStatus: string | null
  publishedAssigneeEmploymentId: string | null
  publishedIsOpen: boolean | null
  publishedStartsAt: Date | null
  publishedEndsAt: Date | null
  publishedBreakMinutes: number | null
  publishedJobRoleId: string | null
  publishedStationId: string | null
  publishedNotes: string | null
}

export type PersonChangeKind = 'added' | 'removed' | 'changed'

export interface PersonChange {
  kind: PersonChangeKind
  shiftId: string
  startsAt: Date
  endsAt: Date
  /** For `changed`: the times they were told before. */
  previousStartsAt: Date | null
  previousEndsAt: Date | null
}

export interface PublicationDiff {
  people: Map<string, PersonChange[]>
  /** Shifts that become visible as open for the first time. */
  newlyOpenShiftIds: string[]
  /** Shifts whose employee-visible state will change at all. */
  changedShiftCount: number
}

const time = (d: Date | null) => (d ? d.getTime() : null)

function detailsDiffer(s: PublishableShift): boolean {
  return (
    time(s.startsAt) !== time(s.publishedStartsAt) ||
    time(s.endsAt) !== time(s.publishedEndsAt) ||
    s.breakMinutes !== s.publishedBreakMinutes ||
    s.jobRoleId !== s.publishedJobRoleId ||
    s.stationId !== s.publishedStationId ||
    s.notes !== s.publishedNotes
  )
}

/** Would publishing now change what employees see for this shift? */
export function hasUnpublishedChange(s: PublishableShift): boolean {
  const liveVisible = s.status === 'active'
  const publishedVisible = s.publishedAt !== null && s.publishedStatus === 'active'
  if (liveVisible !== publishedVisible) return true
  if (!liveVisible) return false
  return (
    detailsDiffer(s) ||
    s.assigneeEmploymentId !== s.publishedAssigneeEmploymentId ||
    s.isOpen !== s.publishedIsOpen
  )
}

export function diffPublication(shifts: readonly PublishableShift[]): PublicationDiff {
  const people = new Map<string, PersonChange[]>()
  const add = (employmentId: string, change: PersonChange) =>
    people.set(employmentId, [...(people.get(employmentId) ?? []), change])

  const newlyOpenShiftIds: string[] = []
  let changedShiftCount = 0

  for (const s of shifts) {
    if (hasUnpublishedChange(s)) changedShiftCount += 1

    const liveVisible = s.status === 'active'
    const publishedVisible = s.publishedAt !== null && s.publishedStatus === 'active'
    const before = publishedVisible ? s.publishedAssigneeEmploymentId : null
    const after = liveVisible ? s.assigneeEmploymentId : null

    if (before && before !== after) {
      add(before, {
        kind: 'removed',
        shiftId: s.id,
        startsAt: s.publishedStartsAt ?? s.startsAt,
        endsAt: s.publishedEndsAt ?? s.endsAt,
        previousStartsAt: null,
        previousEndsAt: null,
      })
    }
    if (after && after !== before) {
      add(after, {
        kind: 'added',
        shiftId: s.id,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        previousStartsAt: null,
        previousEndsAt: null,
      })
    }
    if (after && after === before && detailsDiffer(s)) {
      add(after, {
        kind: 'changed',
        shiftId: s.id,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        previousStartsAt: s.publishedStartsAt,
        previousEndsAt: s.publishedEndsAt,
      })
    }

    const openNow = liveVisible && s.isOpen && s.assigneeEmploymentId === null
    const openBefore = publishedVisible && s.publishedIsOpen === true
    if (openNow && !openBefore) newlyOpenShiftIds.push(s.id)
  }

  return { people, newlyOpenShiftIds, changedShiftCount }
}
