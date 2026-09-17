import type { HandoffCategory, OpsResponseType, OpsTemplateKind } from './schema'

/** The fixed vocabularies, for pages; pages do not import module schemas. */
export { HANDOFF_CATEGORIES, OPS_RESPONSE_TYPES, OPS_TEMPLATE_KINDS } from './schema'

/*
 * SHIFT OPERATIONS RULES.
 *
 * Pure: no database, so every rule the employee workspace, the manager board
 * and generation share - when a task is due, whether a template applies to a
 * shift, what state a task is in and where it belongs on screen - is decided
 * in one place and unit-tested directly.
 *
 * Time is always measured against the shift's PUBLISHED instants, which are
 * already correct for the location's timezone and for shifts that end the
 * next day. Nothing here parses a wall-clock time.
 */

export const OPS_KIND_LABELS: Record<OpsTemplateKind, string> = {
  pre_shift: 'Pre-shift',
  opening: 'Opening duties',
  side_work: 'Side work',
  station_setup: 'Station setup',
  shift_duties: 'Shift duties',
  closing: 'Closing duties',
  handoff: 'Handoff',
}

export const RESPONSE_TYPE_LABELS: Record<OpsResponseType, string> = {
  check: 'Tick when done',
  text: 'A short note',
  number: 'A number (a count or a reading)',
  handoff: 'A handoff note for the next shift',
}

/**
 * Handoff categories, in the business's own words: a restaurant has guests, a
 * salon has clients. The stored value is the same.
 */
export function handoffCategoryLabel(category: HandoffCategory, industry: string): string {
  switch (category) {
    case 'staffing':
      return 'Staffing'
    case 'inventory':
      return 'Inventory'
    case 'maintenance':
      return 'Maintenance'
    case 'safety':
      return 'Safety'
    case 'guest':
      return /salon|spa|beauty|barber/i.test(industry) ? 'Client issue' : 'Guest issue'
    case 'follow_up':
      return 'Follow-up'
  }
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

export interface ShiftTimes {
  startsAt: Date
  endsAt: Date
}

/** When a task is due for a shift: an offset from its start or its end. */
export function dueAt(
  task: { timingAnchor: string; offsetMinutes: number },
  shift: ShiftTimes,
): Date {
  const anchor = task.timingAnchor === 'shift_end' ? shift.endsAt : shift.startsAt
  return new Date(anchor.getTime() + task.offsetMinutes * 60_000)
}

/** "30 min before the shift starts", "When the shift ends", "1 hr 30 min after the shift starts". */
export function describeTiming(anchor: string, offsetMinutes: number): string {
  const point = anchor === 'shift_end' ? 'the shift ends' : 'the shift starts'
  if (offsetMinutes === 0)
    return anchor === 'shift_end' ? 'When the shift ends' : 'When the shift starts'
  const minutes = Math.abs(offsetMinutes)
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  const amount =
    hours === 0 ? `${rest} min` : rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`
  return `${amount} ${offsetMinutes < 0 ? 'before' : 'after'} ${point}`
}

export type ShiftPhase = 'upcoming' | 'before' | 'during' | 'after'

/**
 * Where a shift is relative to now. "Before" is the stretch leading up to the
 * start when pre-shift work is expected; the window is the earliest pre-shift
 * task, at least an hour.
 */
export function shiftPhase(shift: ShiftTimes, now: Date, beforeWindowMinutes = 60): ShiftPhase {
  const t = now.getTime()
  if (t >= shift.endsAt.getTime()) return 'after'
  if (t >= shift.startsAt.getTime()) return 'during'
  if (t >= shift.startsAt.getTime() - Math.max(60, beforeWindowMinutes) * 60_000) return 'before'
  return 'upcoming'
}

// ---------------------------------------------------------------------------
// Targeting
// ---------------------------------------------------------------------------

export interface Targets {
  locationIds: readonly string[]
  jobRoleIds: readonly string[]
  stationIds: readonly string[]
}

export interface ShiftFacts {
  locationId: string
  jobRoleId: string | null
  stationId: string | null
}

/**
 * Does a template version apply to a shift? Each dimension narrows: no
 * targets means any; targets mean the shift must match one. A shift with no
 * role or station never matches a template that names one.
 */
export function templateApplies(targets: Targets, shift: ShiftFacts): boolean {
  if (targets.locationIds.length > 0 && !targets.locationIds.includes(shift.locationId))
    return false
  if (
    targets.jobRoleIds.length > 0 &&
    (!shift.jobRoleId || !targets.jobRoleIds.includes(shift.jobRoleId))
  ) {
    return false
  }
  if (
    targets.stationIds.length > 0 &&
    (!shift.stationId || !targets.stationIds.includes(shift.stationId))
  ) {
    return false
  }
  return true
}

// ---------------------------------------------------------------------------
// Task states
// ---------------------------------------------------------------------------

export interface ItemFacts {
  id: string
  status: string
  dueAt: Date
  position: number
  required: boolean
  responseType: string
  kind: string
  returnedNote: string
}

export type ItemState =
  | 'not_started'
  | 'due_soon'
  | 'overdue'
  | 'returned'
  | 'blocked'
  | 'skipped'
  | 'waiting'
  | 'done'
  | 'cancelled'

/** Minutes before its due time that a task counts as needing attention now. */
export const DUE_SOON_MINUTES = 30

export function itemState(item: ItemFacts, now: Date, runCancelled = false): ItemState {
  if (item.status === 'done') return 'done'
  if (item.status === 'skipped') return 'skipped'
  if (runCancelled) return 'cancelled'
  if (item.status === 'awaiting_verification') return 'waiting'
  if (item.status === 'blocked') return 'blocked'
  if (item.returnedNote.trim().length > 0) return 'returned'
  if (item.dueAt.getTime() <= now.getTime()) return 'overdue'
  if (item.dueAt.getTime() - now.getTime() <= DUE_SOON_MINUTES * 60_000) return 'due_soon'
  return 'not_started'
}

export const ITEM_STATE_LABELS: Record<
  ItemState,
  { label: string; tone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info' }
> = {
  not_started: { label: 'To do', tone: 'neutral' },
  due_soon: { label: 'Due soon', tone: 'info' },
  overdue: { label: 'Overdue', tone: 'danger' },
  returned: { label: 'Sent back', tone: 'warning' },
  blocked: { label: 'Blocked', tone: 'warning' },
  skipped: { label: 'Skipped', tone: 'neutral' },
  waiting: { label: 'Waiting for a manager', tone: 'accent' },
  done: { label: 'Done', tone: 'success' },
  cancelled: { label: 'No longer needed', tone: 'neutral' },
}

/** Resolved means nobody needs to do anything more with it. */
export function isResolved(state: ItemState): boolean {
  return state === 'done' || state === 'skipped' || state === 'cancelled'
}

// ---------------------------------------------------------------------------
// The employee's workspace
// ---------------------------------------------------------------------------

export interface WorkspaceBuckets<T> {
  /** Due before the shift starts, not yet done. */
  beforeShift: T[]
  /** Overdue, due within half an hour, blocked, or sent back. */
  now: T[]
  /** Everything else still to do during the shift. */
  remaining: T[]
  /** Submitted, waiting for a manager to verify. */
  waiting: T[]
  /** Handoff notes to leave before going. */
  handoff: T[]
  /** Done or skipped. */
  done: T[]
}

/**
 * Put each task in exactly one place on the workspace, in the order a person
 * works through a shift. Attention comes first: anything overdue, blocked or
 * sent back is "now" whatever kind of task it is.
 */
export function bucketItems<T extends ItemFacts>(
  items: readonly T[],
  shift: ShiftTimes,
  now: Date,
): WorkspaceBuckets<T> {
  const buckets: WorkspaceBuckets<T> = {
    beforeShift: [],
    now: [],
    remaining: [],
    waiting: [],
    handoff: [],
    done: [],
  }
  const ordered = [...items].sort(
    (a, b) => a.dueAt.getTime() - b.dueAt.getTime() || a.position - b.position,
  )
  for (const item of ordered) {
    const state = itemState(item, now)
    if (state === 'done' || state === 'skipped') buckets.done.push(item)
    else if (state === 'waiting') buckets.waiting.push(item)
    else if (
      state === 'overdue' ||
      state === 'blocked' ||
      state === 'returned' ||
      state === 'due_soon'
    ) {
      buckets.now.push(item)
    } else if (item.responseType === 'handoff' || item.kind === 'handoff')
      buckets.handoff.push(item)
    else if (item.dueAt.getTime() <= shift.startsAt.getTime()) buckets.beforeShift.push(item)
    else buckets.remaining.push(item)
  }
  return buckets
}

// ---------------------------------------------------------------------------
// Progress, for a person's shift and for the manager's board
// ---------------------------------------------------------------------------

export interface Progress {
  total: number
  done: number
  skipped: number
  requiredSkipped: number
  waiting: number
  blocked: number
  overdue: number
  returned: number
  /** Still to do, including anything overdue, blocked or sent back. */
  open: number
  /** Whole percent of tasks resolved; 100 only when nothing is left, waiting included. */
  percent: number
}

export function progressOf(items: readonly ItemFacts[], now: Date): Progress {
  const p: Progress = {
    total: items.length,
    done: 0,
    skipped: 0,
    requiredSkipped: 0,
    waiting: 0,
    blocked: 0,
    overdue: 0,
    returned: 0,
    open: 0,
    percent: 0,
  }
  for (const item of items) {
    const state = itemState(item, now)
    if (state === 'done') p.done += 1
    else if (state === 'skipped') {
      p.skipped += 1
      if (item.required) p.requiredSkipped += 1
    } else if (state === 'waiting') p.waiting += 1
    else {
      p.open += 1
      if (state === 'blocked') p.blocked += 1
      if (state === 'overdue') p.overdue += 1
      if (state === 'returned') p.returned += 1
    }
  }
  const resolved = p.done + p.skipped
  p.percent =
    p.total === 0 ? 0 : resolved === p.total ? 100 : Math.floor((resolved * 100) / p.total)
  return p
}

export type ProgressState = 'not_started' | 'in_progress' | 'needs_attention' | 'complete'

export function progressState(p: Progress): ProgressState {
  if (p.total > 0 && p.done + p.skipped === p.total) return 'complete'
  if (p.blocked + p.overdue + p.returned + p.requiredSkipped > 0) return 'needs_attention'
  if (p.done + p.skipped + p.waiting === 0) return 'not_started'
  return 'in_progress'
}

export const PROGRESS_STATE_LABELS: Record<
  ProgressState,
  { label: string; tone: 'neutral' | 'info' | 'warning' | 'success' }
> = {
  not_started: { label: 'Not started', tone: 'neutral' },
  in_progress: { label: 'In progress', tone: 'info' },
  needs_attention: { label: 'Needs attention', tone: 'warning' },
  complete: { label: 'Complete', tone: 'success' },
}

/** Why a manager should look at a task now, or null when they need not. */
export type Intervention = 'blocked' | 'overdue' | 'waiting' | 'skipped_required' | 'returned'

export function interventionFor(item: ItemFacts, now: Date): Intervention | null {
  const state = itemState(item, now)
  if (state === 'blocked') return 'blocked'
  if (state === 'waiting') return 'waiting'
  if (state === 'overdue') return 'overdue'
  if (state === 'returned') return 'returned'
  if (state === 'skipped' && item.required) return 'skipped_required'
  return null
}

/** Most urgent first: a stopped task outranks one merely late. */
export const INTERVENTION_ORDER: Record<Intervention, number> = {
  blocked: 0,
  overdue: 1,
  waiting: 2,
  skipped_required: 3,
  returned: 4,
}
