import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import type { Tx } from '@/server/db/types'
import type { Actor } from '@/server/authz/actor'
import { authorize, authorizeSelfOr, isSelf } from '@/server/authz/can'
import { ForbiddenError, ValidationError } from '@/lib/errors'
import { newId } from '@/lib/ids'
import { zonedParts } from '@/lib/dates'
import { employments, locations, organizations } from '@/server/db/schema'
import {
  notificationPreferences,
  notifications,
  notificationSettings,
  type NotificationStatus,
} from './schema'
import type { NotificationChannel } from '@/server/notifications/types'

/**
 * NOTIFICATION DELIVERY.
 *
 * Enqueue, then deliver. Nothing sends inline during a request: publishing an
 * announcement to two hundred people writes two hundred rows and returns, and
 * the queue is drained separately. That keeps publication fast, makes retry a
 * property of the data rather than of a request that already ended, and means
 * a provider being down cannot fail a manager's publish.
 *
 * TWO DECISIONS, made when a row is created:
 *
 *   1. Has this person switched this category off on this channel? Then the
 *      row is written as `suppressed` - unless `overridesPreferences` is set.
 *      A suppressed row is the evidence that we deliberately did not tell
 *      somebody something; the announcement itself is still in their inbox.
 *   2. Are they inside quiet hours? Then the row is `pending` with
 *      `scheduled_for` moved to the end of the window - unless
 *      `overridesQuietHours` is set. Delayed, never dropped.
 *
 * The two overrides are deliberately separate and are decided by
 * comms/delivery-policy.ts, not here. Being unable to mute a category is not
 * the same as being allowed to wake somebody up.
 *
 * IDEMPOTENCY. The key is (subject, employment, channel, purpose) and is
 * unique per organization, so a retried publish, a double-clicked button and
 * two workers racing all converge on one row. Callers do not check first; they
 * insert and let the constraint win.
 */

export interface EnqueueInput {
  employmentId: string
  category: string
  channel: NotificationChannel
  subjectType: string
  subjectId: string | null
  title: string
  /** Short and non-sensitive. Never an announcement body. */
  preview?: string
  href?: string | null
  /** Reaches people who switched this category off. See delivery-policy.ts. */
  overridesPreferences?: boolean
  /** Arrives during quiet hours. Narrower than the above; see delivery-policy.ts. */
  overridesQuietHours?: boolean
  /** Distinguishes a reminder from the original for the same subject. */
  purpose?: string
}

export interface EnqueueOutcome {
  created: number
  suppressed: number
  delayed: number
  duplicates: number
}

function idempotencyKey(input: EnqueueInput): string {
  const purpose = input.purpose ?? 'initial'
  return [
    input.subjectType,
    input.subjectId ?? 'none',
    input.employmentId,
    input.channel,
    purpose,
  ].join(':')
}

/**
 * Per-person delivery settings, defaulting sensibly when nothing is stored.
 * Absent preferences mean enabled: nobody should have to opt in to being told
 * about their own work.
 */
export interface DeliveryProfile {
  employmentId: string
  timezone: string
  quietHoursEnabled: boolean
  quietStart: number
  quietEnd: number
  disabled: Set<string>
}

export async function loadDeliveryProfiles(
  tx: Tx,
  organizationId: string,
  employmentIds: string[],
): Promise<Map<string, DeliveryProfile>> {
  const out = new Map<string, DeliveryProfile>()
  if (employmentIds.length === 0) return out

  const [org] = await tx
    .select({ timezone: organizations.timezone })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1)
  const orgTimezone = org?.timezone ?? 'UTC'

  // Home-location timezone is the default when somebody has not set their own.
  const people = await tx
    .select({
      employmentId: employments.id,
      locationTimezone: locations.timezone,
    })
    .from(employments)
    .leftJoin(
      locations,
      and(
        eq(locations.organizationId, employments.organizationId),
        eq(locations.id, employments.homeLocationId),
      ),
    )
    .where(
      and(eq(employments.organizationId, organizationId), inArray(employments.id, employmentIds)),
    )

  const settings = await tx
    .select()
    .from(notificationSettings)
    .where(
      and(
        eq(notificationSettings.organizationId, organizationId),
        inArray(notificationSettings.employmentId, employmentIds),
      ),
    )
  const settingsByPerson = new Map(settings.map((s) => [s.employmentId, s]))

  const prefs = await tx
    .select()
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.organizationId, organizationId),
        inArray(notificationPreferences.employmentId, employmentIds),
        eq(notificationPreferences.enabled, false),
      ),
    )
  const disabledByPerson = new Map<string, Set<string>>()
  for (const pref of prefs) {
    const set = disabledByPerson.get(pref.employmentId) ?? new Set<string>()
    set.add(`${pref.category}:${pref.channel}`)
    disabledByPerson.set(pref.employmentId, set)
  }

  for (const person of people) {
    const s = settingsByPerson.get(person.employmentId)
    out.set(person.employmentId, {
      employmentId: person.employmentId,
      timezone: s?.timezone ?? person.locationTimezone ?? orgTimezone,
      quietHoursEnabled: s?.quietHoursEnabled ?? false,
      quietStart: s?.quietHoursStartMinute ?? 22 * 60,
      quietEnd: s?.quietHoursEndMinute ?? 7 * 60,
      disabled: disabledByPerson.get(person.employmentId) ?? new Set<string>(),
    })
  }
  return out
}

/**
 * Is `instant` inside this person's quiet hours, in THEIR timezone?
 *
 * Handles the overnight case (22:00-07:00) where start > end, which is the
 * normal shape of the setting and the one a naive range check gets wrong.
 */
export function isWithinQuietHours(profile: DeliveryProfile, instant: Date): boolean {
  if (!profile.quietHoursEnabled) return false
  if (profile.quietStart === profile.quietEnd) return false

  const parts = zonedParts(instant, profile.timezone)
  const minute = parts.hour * 60 + parts.minute

  return profile.quietStart < profile.quietEnd
    ? minute >= profile.quietStart && minute < profile.quietEnd
    : minute >= profile.quietStart || minute < profile.quietEnd
}

/** The next instant this person is reachable. */
export function nextDeliverableAt(profile: DeliveryProfile, instant: Date): Date {
  if (!isWithinQuietHours(profile, instant)) return instant

  const parts = zonedParts(instant, profile.timezone)
  const minute = parts.hour * 60 + parts.minute
  // Minutes until the quiet window ends, wrapping past midnight when needed.
  const until =
    minute < profile.quietEnd ? profile.quietEnd - minute : 24 * 60 - minute + profile.quietEnd
  return new Date(instant.getTime() + until * 60_000)
}

/**
 * Write delivery intents. Safe to call again with the same inputs.
 *
 * Returns counts rather than rows because the caller is usually reporting
 * "queued for 38 people, 2 suppressed" back to a manager.
 */
export async function enqueue(
  tx: Tx,
  organizationId: string,
  inputs: readonly EnqueueInput[],
  now = new Date(),
): Promise<EnqueueOutcome> {
  const outcome: EnqueueOutcome = { created: 0, suppressed: 0, delayed: 0, duplicates: 0 }
  if (inputs.length === 0) return outcome

  const profiles = await loadDeliveryProfiles(tx, organizationId, [
    ...new Set(inputs.map((i) => i.employmentId)),
  ])

  const rows = inputs.map((input) => {
    const profile = profiles.get(input.employmentId)
    const overridesPreferences = input.overridesPreferences ?? false
    const overridesQuietHours = input.overridesQuietHours ?? false

    let status: NotificationStatus = 'pending'
    let scheduledFor = now

    if (profile) {
      if (!overridesPreferences && profile.disabled.has(`${input.category}:${input.channel}`)) {
        status = 'suppressed'
      } else if (!overridesQuietHours && isWithinQuietHours(profile, now)) {
        scheduledFor = nextDeliverableAt(profile, now)
      }
    }

    if (status === 'suppressed') outcome.suppressed += 1
    else if (scheduledFor.getTime() !== now.getTime()) outcome.delayed += 1

    return {
      id: newId(),
      organizationId,
      employmentId: input.employmentId,
      category: input.category,
      channel: input.channel,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      title: input.title,
      preview: input.preview ?? '',
      href: input.href ?? null,
      status,
      mandatory: overridesPreferences,
      overridesQuietHours,
      scheduledFor,
      idempotencyKey: idempotencyKey(input),
    }
  })

  // One statement, and the unique constraint absorbs anything already queued.
  const inserted = await tx
    .insert(notifications)
    .values(rows)
    .onConflictDoNothing({
      target: [notifications.organizationId, notifications.idempotencyKey],
    })
    .returning({ id: notifications.id })

  outcome.created = inserted.length
  outcome.duplicates = rows.length - inserted.length
  // The suppressed/delayed counts describe intent; correct them for rows that
  // turned out to be duplicates of something already queued.
  if (outcome.duplicates > 0) {
    outcome.suppressed = Math.min(outcome.suppressed, outcome.created)
    outcome.delayed = Math.min(outcome.delayed, outcome.created)
  }
  return outcome
}

// ---------------------------------------------------------------------------
// Delivery: claim, send, complete
// ---------------------------------------------------------------------------

/*
 * Delivery is three steps in three transactions, and the split is the point.
 *
 *   claim     a short transaction that LEASES due rows: `locked_until` in the
 *             future, a fresh `claim_token`, attempts + 1. It uses
 *             FOR UPDATE SKIP LOCKED, so concurrent workers take disjoint
 *             rows instead of queueing behind each other or double-sending.
 *   send      outside any transaction - a slow provider must not hold locks.
 *   complete  records the outcome, but only if the row still carries the
 *             claim token. A worker whose lease expired mid-send cannot
 *             overwrite the result of whoever re-claimed the row.
 *
 * Crash recovery is therefore automatic: a worker that dies between claim and
 * complete leaves a lease that simply expires, and the row is claimable again.
 *
 * In-app delivery is exactly-once: "sending" is recording the row as sent.
 * An external channel is at-least-once in the narrow window where a provider
 * accepted the message but the worker died before completing - the lease is
 * sized well above a normal send so that window is small, and the provider
 * integration (when a sending domain is approved) should pass the notification
 * id as its idempotency key to close it.
 */

/** Attempts before a notification is marked failed for good. */
export const MAX_DELIVERY_ATTEMPTS = 5

/** How long a claim is held before another worker may take the row. */
export const DELIVERY_LEASE_MS = 2 * 60_000

/** 30s, 2m, 8m, 32m - then capped at an hour. Deterministic, so it is testable. */
export function retryBackoffMs(attempt: number): number {
  const base = 30_000 * 4 ** Math.max(0, attempt - 1)
  return Math.min(base, 60 * 60_000)
}

export interface ClaimedNotification {
  id: string
  employmentId: string
  channel: string
  title: string
  preview: string
  href: string | null
  attempts: number
  claimToken: string
  /** Only loaded for the email channel, and never logged. */
  emailAddress: string | null
}

export async function claimDueNotifications(
  tx: Tx,
  organizationId: string,
  options: { now: Date; limit?: number; leaseMs?: number },
): Promise<ClaimedNotification[]> {
  const now = options.now
  const lockedUntil = new Date(now.getTime() + (options.leaseMs ?? DELIVERY_LEASE_MS))
  const claimToken = newId()
  const limit = options.limit ?? 100

  const result = await tx.execute<{
    id: string
    employment_id: string
    channel: string
    title: string
    preview: string
    href: string | null
    attempts: number
  }>(sql`
    with candidates as (
      select id
        from notifications
       where organization_id = ${organizationId}
         and status = 'pending'
         and scheduled_for <= ${now.toISOString()}::timestamptz
         and (locked_until is null or locked_until <= ${now.toISOString()}::timestamptz)
       order by scheduled_for
       limit ${limit}
       for update skip locked
    )
    update notifications as n
       set locked_until = ${lockedUntil.toISOString()}::timestamptz,
           claim_token = ${claimToken}::uuid,
           attempts = n.attempts + 1,
           last_attempt_at = ${now.toISOString()}::timestamptz
      from candidates as c
     where n.id = c.id
       and n.organization_id = ${organizationId}
    returning n.id, n.employment_id, n.channel, n.title, n.preview, n.href, n.attempts
  `)

  const rows = result.rows
  const emailIds = rows.filter((r) => r.channel === 'email').map((r) => r.employment_id)
  const addresses = new Map<string, string | null>()
  if (emailIds.length > 0) {
    const people = await tx
      .select({ id: employments.id, email: employments.email })
      .from(employments)
      .where(and(eq(employments.organizationId, organizationId), inArray(employments.id, emailIds)))
    for (const person of people) addresses.set(person.id, person.email)
  }

  return rows.map((row) => ({
    id: row.id,
    employmentId: row.employment_id,
    channel: row.channel,
    title: row.title,
    preview: row.preview,
    href: row.href,
    attempts: Number(row.attempts),
    claimToken,
    emailAddress: row.channel === 'email' ? (addresses.get(row.employment_id) ?? null) : null,
  }))
}

export type DeliveryOutcome =
  | { kind: 'sent' }
  /** A fault that may clear up: retried with backoff until attempts run out. */
  | { kind: 'transient'; reason: string }
  /** A fault that will not clear up by waiting: failed immediately. */
  | { kind: 'permanent'; reason: string }

export type CompletionResult = 'sent' | 'retrying' | 'failed' | 'lease_lost'

export async function completeDelivery(
  tx: Tx,
  organizationId: string,
  claim: { id: string; claimToken: string; attempts: number },
  outcome: DeliveryOutcome,
  now: Date,
): Promise<CompletionResult> {
  const owned = and(
    eq(notifications.organizationId, organizationId),
    eq(notifications.id, claim.id),
    eq(notifications.claimToken, claim.claimToken),
    eq(notifications.status, 'pending'),
  )

  if (outcome.kind === 'sent') {
    const rows = await tx
      .update(notifications)
      .set({
        status: 'sent',
        sentAt: now,
        lockedUntil: null,
        claimToken: null,
        failureReason: null,
      })
      .where(owned)
      .returning({ id: notifications.id })
    return rows.length > 0 ? 'sent' : 'lease_lost'
  }

  // The reason is shown to an administrator, so it is trimmed and must never
  // carry a provider secret or anything about the employee.
  const reason = outcome.reason.slice(0, 300)
  const exhausted = claim.attempts >= MAX_DELIVERY_ATTEMPTS

  if (outcome.kind === 'permanent' || exhausted) {
    const rows = await tx
      .update(notifications)
      .set({
        status: 'failed',
        failedAt: now,
        failureReason: reason,
        lockedUntil: null,
        claimToken: null,
      })
      .where(owned)
      .returning({ id: notifications.id })
    return rows.length > 0 ? 'failed' : 'lease_lost'
  }

  const rows = await tx
    .update(notifications)
    .set({
      scheduledFor: new Date(now.getTime() + retryBackoffMs(claim.attempts)),
      failureReason: reason,
      lockedUntil: null,
      claimToken: null,
    })
    .where(owned)
    .returning({ id: notifications.id })
  return rows.length > 0 ? 'retrying' : 'lease_lost'
}

/** Put a failed notification back in the queue with a fresh set of attempts. */
export async function retryFailed(tx: Tx, actor: Actor, notificationId: string): Promise<void> {
  authorize(actor, 'notification.administer')
  await tx
    .update(notifications)
    .set({
      status: 'pending',
      failureReason: null,
      failedAt: null,
      attempts: 0,
      lockedUntil: null,
      claimToken: null,
      scheduledFor: new Date(),
    })
    .where(
      and(
        eq(notifications.organizationId, actor.organizationId),
        eq(notifications.id, notificationId),
        eq(notifications.status, 'failed'),
      ),
    )
}

/** Stop anything still queued for a subject that no longer applies. */
export async function cancelForSubject(
  tx: Tx,
  organizationId: string,
  subjectType: string,
  subjectId: string,
): Promise<number> {
  const cancelled = await tx
    .update(notifications)
    .set({ status: 'cancelled' })
    .where(
      and(
        eq(notifications.organizationId, organizationId),
        eq(notifications.subjectType, subjectType),
        eq(notifications.subjectId, subjectId),
        eq(notifications.status, 'pending'),
      ),
    )
    .returning({ id: notifications.id })
  return cancelled.length
}

// ---------------------------------------------------------------------------
// The in-app bell
// ---------------------------------------------------------------------------

export interface InAppNotification {
  id: string
  title: string
  preview: string
  href: string | null
  category: string
  createdAt: Date
  readAt: Date | null
}

/**
 * Somebody's own in-app feed.
 *
 * Self-access ONLY - deliberately not `authorizeSelfOr(..., 'notification.administer')`.
 * That capability is for inspecting the delivery QUEUE: what is stuck, what
 * failed, what needs retrying. Reading the messages a named employee has
 * received is a different thing, and the fact that an administrator can debug
 * delivery is not a reason to let them read somebody's feed. The inbox applies
 * the same rule.
 */
export async function listInApp(
  tx: Tx,
  actor: Actor,
  employmentId: string,
  options: { includeRead?: boolean; limit?: number } = {},
): Promise<InAppNotification[]> {
  if (!isSelf(actor, employmentId)) throw new ForbiddenError('notifications.self')

  const rows = await tx
    .select({
      id: notifications.id,
      title: notifications.title,
      preview: notifications.preview,
      href: notifications.href,
      category: notifications.category,
      createdAt: notifications.createdAt,
      readAt: notifications.readAt,
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.organizationId, actor.organizationId),
        eq(notifications.employmentId, employmentId),
        eq(notifications.channel, 'in_app'),
        or(eq(notifications.status, 'sent'), eq(notifications.status, 'pending')),
        options.includeRead ? undefined : isNull(notifications.readAt),
      ),
    )
    .orderBy(sql`${notifications.createdAt} desc`)
    .limit(options.limit ?? 30)

  return rows
}

export async function markNotificationRead(
  tx: Tx,
  actor: Actor,
  notificationId: string,
): Promise<void> {
  // Ownership: you may only mark your own notifications read.
  await tx
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.organizationId, actor.organizationId),
        eq(notifications.id, notificationId),
        eq(notifications.employmentId, actor.employmentId),
        isNull(notifications.readAt),
      ),
    )
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

export interface PreferenceView {
  category: string
  channel: NotificationChannel
  enabled: boolean
  /** True when this category ignores the switch, so the UI can say so. */
  overridden: boolean
}

export async function getSettings(
  tx: Tx,
  actor: Actor,
  employmentId: string,
): Promise<{
  quietHoursEnabled: boolean
  quietStart: number
  quietEnd: number
  timezone: string | null
  effectiveTimezone: string
}> {
  authorizeSelfOr(actor, employmentId, 'notification.administer')

  const [row] = await tx
    .select()
    .from(notificationSettings)
    .where(
      and(
        eq(notificationSettings.organizationId, actor.organizationId),
        eq(notificationSettings.employmentId, employmentId),
      ),
    )
    .limit(1)

  const profiles = await loadDeliveryProfiles(tx, actor.organizationId, [employmentId])
  const effective = profiles.get(employmentId)

  return {
    quietHoursEnabled: row?.quietHoursEnabled ?? false,
    quietStart: row?.quietHoursStartMinute ?? 22 * 60,
    quietEnd: row?.quietHoursEndMinute ?? 7 * 60,
    timezone: row?.timezone ?? null,
    effectiveTimezone: effective?.timezone ?? 'UTC',
  }
}

export async function saveSettings(
  tx: Tx,
  actor: Actor,
  employmentId: string,
  input: {
    quietHoursEnabled: boolean
    quietStart: number
    quietEnd: number
    timezone: string | null
  },
): Promise<void> {
  authorizeSelfOr(actor, employmentId, 'notification.administer')

  for (const value of [input.quietStart, input.quietEnd]) {
    if (!Number.isInteger(value) || value < 0 || value > 1439) {
      throw new ValidationError({ quietHours: ['Choose a time of day.'] }, 'Invalid quiet hours')
    }
  }
  if (input.timezone !== null && !isValidTimezone(input.timezone)) {
    throw new ValidationError(
      { timezone: ['That is not a timezone we recognise.'] },
      'Invalid timezone',
    )
  }

  await tx
    .insert(notificationSettings)
    .values({
      id: newId(),
      organizationId: actor.organizationId,
      employmentId,
      quietHoursEnabled: input.quietHoursEnabled,
      quietHoursStartMinute: input.quietStart,
      quietHoursEndMinute: input.quietEnd,
      timezone: input.timezone,
    })
    .onConflictDoUpdate({
      target: [notificationSettings.organizationId, notificationSettings.employmentId],
      set: {
        quietHoursEnabled: input.quietHoursEnabled,
        quietHoursStartMinute: input.quietStart,
        quietHoursEndMinute: input.quietEnd,
        timezone: input.timezone,
        updatedAt: new Date(),
      },
    })
}

export function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

export async function setPreference(
  tx: Tx,
  actor: Actor,
  employmentId: string,
  category: string,
  channel: NotificationChannel,
  enabled: boolean,
): Promise<void> {
  authorizeSelfOr(actor, employmentId, 'notification.administer')

  await tx
    .insert(notificationPreferences)
    .values({
      id: newId(),
      organizationId: actor.organizationId,
      employmentId,
      category,
      channel,
      enabled,
    })
    .onConflictDoUpdate({
      target: [
        notificationPreferences.organizationId,
        notificationPreferences.employmentId,
        notificationPreferences.category,
        notificationPreferences.channel,
      ],
      set: { enabled, updatedAt: new Date() },
    })
}

export async function listPreferences(
  tx: Tx,
  actor: Actor,
  employmentId: string,
): Promise<Map<string, boolean>> {
  authorizeSelfOr(actor, employmentId, 'notification.administer')

  const rows = await tx
    .select({
      category: notificationPreferences.category,
      channel: notificationPreferences.channel,
      enabled: notificationPreferences.enabled,
    })
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.organizationId, actor.organizationId),
        eq(notificationPreferences.employmentId, employmentId),
      ),
    )

  return new Map(rows.map((r) => [`${r.category}:${r.channel}`, r.enabled]))
}
