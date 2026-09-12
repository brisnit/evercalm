/**
 * NOTIFICATION AND AUDIENCE ARCHITECTURE.
 *
 * Types only - no tables, no UI, nothing shipped in Slice 1.
 *
 * These exist now so that announcements (Slice 3), schedule notifications
 * (Slice 4), and two-way messaging (Phase 2) all resolve recipients through
 * ONE audience concept rather than each inventing its own. Messaging is the
 * reason this is defined here: adding conversations later must not require
 * reworking how EverCalm decides who receives something.
 *
 * Nothing in the interface offers these capabilities yet.
 */

export const NOTIFICATION_CHANNELS = ['in_app', 'email', 'sms', 'push'] as const
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number]

export const NOTIFICATION_CATEGORIES = [
  'announcement',
  'acknowledgement_required',
  'schedule_published',
  'schedule_changed',
  'shift_reminder',
  'swap_request',
  'time_off_decision',
  'training_assigned',
  'training_due',
  'skill_verified',
  'checklist_due',
  'handoff_open',
  /** Phase 2. Declared so preferences and quiet hours already cover it. */
  'direct_message',
] as const
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]

/**
 * How a set of recipients is described. Every feature that sends something
 * targets an audience built from these selectors, so recipient resolution is
 * written once.
 */
export type AudienceSelector =
  | { type: 'organization' }
  | { type: 'location'; locationId: string }
  | { type: 'job_role'; jobRoleId: string }
  | { type: 'team'; teamId: string }
  | { type: 'employment'; employmentId: string }
  /** Phase 2: the participants of a conversation. */
  | { type: 'conversation'; conversationId: string }

export interface Audience {
  readonly include: readonly AudienceSelector[]
  readonly exclude?: readonly AudienceSelector[]
}

/** A resolved recipient. Always an employment - never a raw user. */
export interface Recipient {
  readonly employmentId: string
  readonly organizationId: string
  readonly locationIds: readonly string[]
}

/**
 * Quiet hours are stored per employment in the location's timezone.
 * `urgentOverridesQuietHours` is why announcement.publish_urgent is a separate
 * capability: overriding someone's quiet hours should be a deliberate,
 * permissioned act.
 */
export interface QuietHours {
  readonly startMinuteOfDay: number
  readonly endMinuteOfDay: number
  readonly timezone: string
}

export interface NotificationPreference {
  readonly employmentId: string
  readonly category: NotificationCategory
  readonly channel: NotificationChannel
  readonly enabled: boolean
  readonly quietHours: QuietHours | null
  readonly urgentOverridesQuietHours: boolean
}
