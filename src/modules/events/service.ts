import { and, asc, eq, gte, isNull } from 'drizzle-orm'
import type { Tx } from '@/server/db/types'
import type { Actor } from '@/server/authz/actor'
import { accessibleLocationIds, authorize } from '@/server/authz/can'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { newId } from '@/lib/ids'
import { AUDIT_ACTIONS, recordAuditEvent } from '@/server/audit'
import { locations } from '@/server/db/schema'
import { EVENT_KINDS, events, type EventKind } from './schema'

/**
 * EVENTS.
 *
 * A list, not a calendar. See schema.ts for what is deliberately deferred.
 * The service exists so announcements can point at a real record rather than
 * repeating a date in prose, and so the demo tenants can carry the large-party
 * and continuing-education notes the industries actually run on.
 */

export const EVENT_KIND_LABELS: Record<EventKind, string> = {
  large_party: 'Large party',
  training: 'Training',
  inspection: 'Inspection',
  promotion: 'Promotion',
  general: 'General',
}

export interface EventView {
  id: string
  title: string
  description: string
  kind: EventKind
  locationId: string | null
  locationName: string | null
  startsAt: Date
  endsAt: Date | null
  allDay: boolean
  notes: string
}

export interface EventInput {
  title: string
  description: string
  kind: EventKind
  locationId: string | null
  startsAt: Date
  endsAt: Date | null
  allDay: boolean
  notes: string
}

function validate(input: EventInput): void {
  const fieldErrors: Record<string, string[]> = {}
  if (input.title.trim().length < 2) fieldErrors.title = ['Give the event a name.']
  if (!EVENT_KINDS.includes(input.kind)) fieldErrors.kind = ['Choose a type.']
  if (Number.isNaN(input.startsAt.getTime())) fieldErrors.startsAt = ['Choose when it starts.']
  if (input.endsAt && input.endsAt.getTime() < input.startsAt.getTime()) {
    fieldErrors.endsAt = ['The end cannot be before the start.']
  }
  if (Object.keys(fieldErrors).length > 0) {
    throw new ValidationError(fieldErrors, 'Check the event before saving.')
  }
}

/** A location-scoped manager may only put events at their own locations. */
function assertLocationInScope(actor: Actor, locationId: string | null): void {
  const allowed = accessibleLocationIds(actor, 'event.manage')
  if (allowed === null) return
  if (locationId === null) {
    throw new ValidationError(
      { locationId: ['Choose which location this is for.'] },
      'An organization-wide event needs an organization-wide permission.',
    )
  }
  if (!allowed.includes(locationId)) {
    throw new ValidationError(
      { locationId: ['That is not one of your locations.'] },
      'You can only add events at your own locations.',
    )
  }
}

export async function listEvents(
  tx: Tx,
  actor: Actor,
  options: { upcomingOnly?: boolean; from?: Date } = {},
): Promise<EventView[]> {
  const from = options.from ?? new Date()
  const rows = await tx
    .select({
      id: events.id,
      title: events.title,
      description: events.description,
      kind: events.kind,
      locationId: events.locationId,
      locationName: locations.name,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      allDay: events.allDay,
      notes: events.notes,
    })
    .from(events)
    .leftJoin(
      locations,
      and(eq(locations.organizationId, events.organizationId), eq(locations.id, events.locationId)),
    )
    .where(
      and(
        eq(events.organizationId, actor.organizationId),
        isNull(events.archivedAt),
        options.upcomingOnly === false ? undefined : gte(events.startsAt, from),
      ),
    )
    .orderBy(asc(events.startsAt))

  return rows.map((r) => ({ ...r, kind: r.kind as EventKind }))
}

export async function createEvent(tx: Tx, actor: Actor, input: EventInput): Promise<string> {
  authorize(actor, 'event.manage', input.locationId ? { locationId: input.locationId } : {})
  validate(input)
  assertLocationInScope(actor, input.locationId)

  const id = newId()
  await tx.insert(events).values({
    id,
    organizationId: actor.organizationId,
    locationId: input.locationId,
    title: input.title.trim(),
    description: input.description.trim(),
    kind: input.kind,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    allDay: input.allDay,
    notes: input.notes.trim(),
    createdByEmploymentId: actor.employmentId,
  })

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.EVENT_CREATED,
    summary: `Added the event "${input.title.trim()}"`,
    subjectType: 'event',
    subjectId: id,
    locationId: input.locationId,
  })
  return id
}

export async function archiveEvent(tx: Tx, actor: Actor, eventId: string): Promise<void> {
  const [row] = await tx
    .select({ title: events.title, locationId: events.locationId })
    .from(events)
    .where(and(eq(events.organizationId, actor.organizationId), eq(events.id, eventId)))
    .limit(1)
  if (!row) throw new NotFoundError('Event not found')

  authorize(actor, 'event.manage', row.locationId ? { locationId: row.locationId } : {})

  await tx
    .update(events)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(events.organizationId, actor.organizationId), eq(events.id, eventId)))

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.EVENT_ARCHIVED,
    summary: `Archived the event "${row.title}"`,
    subjectType: 'event',
    subjectId: eventId,
  })
}

/** Events an author can attach to an announcement. */
export async function selectableEvents(tx: Tx, actor: Actor): Promise<EventView[]> {
  const all = await listEvents(tx, actor, { upcomingOnly: true })
  const allowed = accessibleLocationIds(actor, 'announcement.create')
  if (allowed === null) return all
  return all.filter((e) => e.locationId === null || allowed.includes(e.locationId))
}
