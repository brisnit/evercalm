import { and, eq } from 'drizzle-orm'
import type { Tx } from '@/server/db'
import type { Actor } from '@/server/authz/actor'
import { NotFoundError } from '@/lib/errors'
import { employments, schedules, shifts } from '@/server/db/schema'
import { requireLocation } from '@/modules/scheduling/access'
import { formatShift } from '@/modules/scheduling/time'

/** The one shift a picker or call-out page is about, in words. */
export async function shiftDetail(tx: Tx, actor: Actor, shiftId: string) {
  const [row] = await tx
    .select({
      id: shifts.id,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      locationId: shifts.locationId,
      scheduleId: shifts.scheduleId,
      assigneeId: shifts.assigneeEmploymentId,
      assigneeName: employments.displayName,
      weekStart: schedules.weekStart,
    })
    .from(shifts)
    .innerJoin(
      schedules,
      and(eq(schedules.organizationId, shifts.organizationId), eq(schedules.id, shifts.scheduleId)),
    )
    .leftJoin(
      employments,
      and(
        eq(employments.organizationId, shifts.organizationId),
        eq(employments.id, shifts.assigneeEmploymentId),
      ),
    )
    .where(and(eq(shifts.organizationId, actor.organizationId), eq(shifts.id, shiftId)))
    .limit(1)
  if (!row) throw new NotFoundError('Shift not found')

  const location = await requireLocation(tx, actor.organizationId, row.locationId)
  const label = formatShift(row.startsAt, row.endsAt, location.timeZone)
  return { ...row, day: label.day, time: label.time, locationName: location.name }
}
