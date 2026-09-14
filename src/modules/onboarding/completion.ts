import { and, eq } from 'drizzle-orm'
import type { Tx } from '@/server/db'
import { onboardingAssignments, onboardingStepProgress } from '@/server/db/schema'

/**
 * Bring a run's completion in line with its steps: complete when every step
 * that is both required and blocking is done or waived.
 *
 * Shared by manual step completion and by the training link, which completes
 * a step when its course is finished - possibly as the result of a manager's
 * sign-off rather than anything the new hire did.
 *
 * The first completion time is kept, so re-checking a finished run never moves
 * the date it finished.
 */
export async function refreshOnboardingCompletion(
  tx: Tx,
  organizationId: string,
  assignmentId: string,
  now = new Date(),
): Promise<{ done: boolean; justCompleted: boolean }> {
  const [assignment] = await tx
    .select({ completedAt: onboardingAssignments.completedAt })
    .from(onboardingAssignments)
    .where(
      and(
        eq(onboardingAssignments.organizationId, organizationId),
        eq(onboardingAssignments.id, assignmentId),
      ),
    )
    .limit(1)
  if (!assignment) return { done: false, justCompleted: false }

  const rows = await tx
    .select({
      required: onboardingStepProgress.required,
      blocksCompletion: onboardingStepProgress.blocksCompletion,
      status: onboardingStepProgress.status,
    })
    .from(onboardingStepProgress)
    .where(
      and(
        eq(onboardingStepProgress.organizationId, organizationId),
        eq(onboardingStepProgress.assignmentId, assignmentId),
      ),
    )

  const gating = rows.filter((r) => r.required && r.blocksCompletion)
  const done =
    gating.length > 0 && gating.every((r) => r.status === 'completed' || r.status === 'waived')

  await tx
    .update(onboardingAssignments)
    .set({ completedAt: done ? (assignment.completedAt ?? now) : null, updatedAt: now })
    .where(
      and(
        eq(onboardingAssignments.organizationId, organizationId),
        eq(onboardingAssignments.id, assignmentId),
      ),
    )

  return { done, justCompleted: done && !assignment.completedAt }
}
