import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import {
  employmentJobRoles,
  employments,
  onboardingAssignments,
  onboardingSections,
  onboardingStepProgress,
  onboardingSteps,
  onboardingTemplateJobRoles,
  onboardingTemplateLocations,
  onboardingTemplateVersions,
  onboardingTemplates,
} from '@/server/db/schema'
import type { Tx } from '@/server/db'
import { newId } from '@/lib/ids'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { authorize, can, canAtAnyLocation, isSelf } from '@/server/authz/can'
import type { Actor } from '@/server/authz/actor'
import { AUDIT_ACTIONS, recordAuditEvent } from '@/server/audit'
import { addCalendarDays } from '@/lib/dates'
import { MANAGER_ONLY_KINDS, UNRESOLVED_KINDS, linkedCourseTitles } from './templates'
import { refreshOnboardingCompletion } from './completion'
import {
  UNLINKED_TRAINING_REASON,
  linkTrainingOnStart,
  linkedTrainingViews,
  type LinkedTraining,
  type StepToLink,
} from './training-link'

/**
 * ONBOARDING RUNS.
 *
 * A run is one person's pass through one immutable template VERSION. Content
 * is copied into `onboarding_step_progress` at assignment time, so a published
 * version being superseded, a template being renamed, or a template being
 * archived can never rewrite somebody's history.
 *
 * Two rules the code enforces rather than merely intends:
 *
 *  1. **An employee can never complete a step a manager must confirm.** That
 *     covers `practical_verification`, `manager_task`, and any step configured
 *     with `requiresManagerVerification`. The verifier is recorded by name.
 *  2. **Steps waiting on an unshipped EverCalm feature are visibly waiting,
 *     never quietly completable** - and they do not count as "blocked" for the
 *     manager's board, because nobody in the business can clear them.
 */

export type OnboardingState = 'not_started' | 'in_progress' | 'blocked' | 'overdue' | 'completed'

export interface OnboardingStepView {
  id: string
  stepId: string
  sectionTitle: string
  title: string
  instructions: string
  kind: string
  responsibility: string
  required: boolean
  requiresManagerVerification: boolean
  blocksCompletion: boolean
  status: string
  position: number
  dueOn: string | null
  note: string | null
  blockedReason: string | null
  completedAt: Date | null
  completedBy: string | null
  verifiedBy: string | null
  /** True when the actor viewing this may complete it themselves. */
  selfCompletable: boolean
  /** True when it needs a manager, and the viewer is one. */
  awaitingVerification: boolean
  /** True when it waits on an EverCalm feature rather than on a person. */
  awaitingPlatform: boolean
  /** For a training step: the linked course and how it stands. */
  training: LinkedTraining | null
}

export interface OnboardingProgress {
  assignmentId: string
  employmentId: string
  employeeName: string
  templateName: string
  templateVersionNumber: number
  startedOn: string
  dueOn: string | null
  completedAt: Date | null
  state: OnboardingState
  requiredTotal: number
  requiredDone: number
  percentComplete: number
  /** The single next thing this person should do. Null when finished. */
  nextAction: string | null
  steps: OnboardingStepView[]
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/** True when only a manager may mark this step complete. */
export function needsManagerToComplete(step: {
  kind: string
  requiresManagerVerification: boolean
}): boolean {
  return MANAGER_ONLY_KINDS.has(step.kind) || step.requiresManagerVerification
}

/** The location a capability check about this person should be scoped to. */
async function subjectLocation(tx: Tx, actor: Actor, employmentId: string): Promise<string | null> {
  const [row] = await tx
    .select({ homeLocationId: employments.homeLocationId })
    .from(employments)
    .where(
      and(eq(employments.organizationId, actor.organizationId), eq(employments.id, employmentId)),
    )
    .limit(1)
  return row?.homeLocationId ?? null
}

export function deriveState(
  steps: {
    required: boolean
    blocksCompletion?: boolean
    status: string
    dueOn: string | null
    kind: string
  }[],
  completedAt: Date | null,
): OnboardingState {
  if (completedAt) return 'completed'

  // A step gates completion only if it is both required and blocking.
  const gating = steps.filter((s) => s.required && (s.blocksCompletion ?? true))
  if (gating.length > 0 && gating.every((s) => s.status === 'completed' || s.status === 'waived')) {
    return 'completed'
  }

  // "Blocked" means a HUMAN here needs to do something. A step waiting on an
  // EverCalm feature that has not shipped is not this person's problem, and
  // counting it would put every new hire in the blocked column and make the
  // manager's board useless.
  if (steps.some((s) => s.status === 'blocked' && !UNRESOLVED_KINDS.has(s.kind))) {
    return 'blocked'
  }

  const now = today()
  if (gating.some((s) => s.status === 'pending' && s.dueOn !== null && s.dueOn < now)) {
    return 'overdue'
  }
  if (steps.some((s) => s.status === 'completed' || s.status === 'waived')) return 'in_progress'
  return 'not_started'
}

const POLICY_REASON =
  'Your manager will share this document with you here. There is nothing to do until then.'

/**
 * The wording steps waiting on a policy document were once stored with. It
 * described the product roadmap rather than the person's situation, so it is
 * shown as the current wording wherever it is still stored.
 */
const LEGACY_POLICY_REASON = 'Waiting on policy documents, which arrive in a later release.'

function displayReason(reason: string | null): string | null {
  return reason === LEGACY_POLICY_REASON ? POLICY_REASON : reason
}

function blockedReasonFor(kind: string, courseId: string | null = null): string | null {
  // A linked training step is satisfied by its course; an unlinked one needs a person.
  if (kind === 'training_assignment') return courseId ? null : UNLINKED_TRAINING_REASON
  if (kind === 'policy_ack') {
    return POLICY_REASON
  }
  return null
}

/**
 * Pick the template for a new hire.
 *
 * Only PUBLISHED, non-archived templates are considered, so an unfinished
 * draft can never reach somebody by accident. A template that names a job role
 * or location it does not match is excluded outright, so targeting narrows
 * rather than merely reorders. Preference: role and location, then role, then
 * location, then the organization default.
 */
export async function resolveTemplateForAssignment(
  tx: Tx,
  actor: Actor,
  input: { jobRoleIds: string[]; locationId: string | null },
): Promise<{ templateId: string; versionId: string; versionNumber: number; name: string } | null> {
  const candidates = await tx
    .select({
      id: onboardingTemplates.id,
      name: onboardingTemplates.name,
      isDefault: onboardingTemplates.isDefault,
      publishedVersionId: onboardingTemplates.publishedVersionId,
      versionNumber: onboardingTemplateVersions.versionNumber,
    })
    .from(onboardingTemplates)
    .innerJoin(
      onboardingTemplateVersions,
      and(
        eq(onboardingTemplateVersions.id, onboardingTemplates.publishedVersionId),
        eq(onboardingTemplateVersions.organizationId, onboardingTemplates.organizationId),
      ),
    )
    .where(
      and(
        eq(onboardingTemplates.organizationId, actor.organizationId),
        eq(onboardingTemplates.status, 'published'),
        isNull(onboardingTemplates.archivedAt),
      ),
    )

  if (candidates.length === 0) return null
  const ids = candidates.map((c) => c.id)

  const roleTargets = await tx
    .select({
      templateId: onboardingTemplateJobRoles.templateId,
      jobRoleId: onboardingTemplateJobRoles.jobRoleId,
    })
    .from(onboardingTemplateJobRoles)
    .where(
      and(
        eq(onboardingTemplateJobRoles.organizationId, actor.organizationId),
        inArray(onboardingTemplateJobRoles.templateId, ids),
      ),
    )

  const locationTargets = await tx
    .select({
      templateId: onboardingTemplateLocations.templateId,
      locationId: onboardingTemplateLocations.locationId,
    })
    .from(onboardingTemplateLocations)
    .where(
      and(
        eq(onboardingTemplateLocations.organizationId, actor.organizationId),
        inArray(onboardingTemplateLocations.templateId, ids),
      ),
    )

  const scored = candidates.map((c) => {
    const roles = roleTargets.filter((r) => r.templateId === c.id).map((r) => r.jobRoleId)
    const locs = locationTargets.filter((l) => l.templateId === c.id).map((l) => l.locationId)
    const roleMatch = roles.length > 0 && roles.some((r) => input.jobRoleIds.includes(r))
    const locationMatch =
      locs.length > 0 && input.locationId !== null && locs.includes(input.locationId)
    const excluded = (roles.length > 0 && !roleMatch) || (locs.length > 0 && !locationMatch)

    let score = -1
    if (!excluded) {
      if (roleMatch && locationMatch) score = 4
      else if (roleMatch) score = 3
      else if (locationMatch) score = 2
      else if (c.isDefault) score = 1
      else score = 0
    }
    return { ...c, score }
  })

  const best = scored.filter((c) => c.score >= 0).sort((a, b) => b.score - a.score)[0]
  if (!best?.publishedVersionId) return null

  return {
    templateId: best.id,
    versionId: best.publishedVersionId,
    versionNumber: best.versionNumber,
    name: best.name,
  }
}

export async function assignOnboarding(
  tx: Tx,
  actor: Actor,
  employmentId: string,
  startedOn?: string,
): Promise<string> {
  authorize(actor, 'people.manage_employment')

  const [person] = await tx
    .select({
      id: employments.id,
      displayName: employments.displayName,
      homeLocationId: employments.homeLocationId,
      hiredOn: employments.hiredOn,
    })
    .from(employments)
    .where(
      and(eq(employments.organizationId, actor.organizationId), eq(employments.id, employmentId)),
    )
    .limit(1)
  if (!person) throw new NotFoundError('Employee not found')

  const existing = await tx
    .select({ id: onboardingAssignments.id })
    .from(onboardingAssignments)
    .where(
      and(
        eq(onboardingAssignments.organizationId, actor.organizationId),
        eq(onboardingAssignments.employmentId, employmentId),
      ),
    )
    .limit(1)
  if (existing[0]) return existing[0].id

  const personRoles = await tx
    .select({ jobRoleId: employmentJobRoles.jobRoleId })
    .from(employmentJobRoles)
    .where(
      and(
        eq(employmentJobRoles.organizationId, actor.organizationId),
        eq(employmentJobRoles.employmentId, employmentId),
      ),
    )

  const template = await resolveTemplateForAssignment(tx, actor, {
    jobRoleIds: personRoles.map((r) => r.jobRoleId),
    locationId: person.homeLocationId,
  })
  if (!template) {
    throw new ValidationError(
      {},
      'No published onboarding checklist matches this person yet. Publish one first.',
    )
  }

  const start = startedOn ?? today()
  const hireDate = person.hiredOn ?? start

  const sections = await tx
    .select()
    .from(onboardingSections)
    .where(
      and(
        eq(onboardingSections.organizationId, actor.organizationId),
        eq(onboardingSections.versionId, template.versionId),
      ),
    )
    .orderBy(asc(onboardingSections.position))

  const steps = await tx
    .select()
    .from(onboardingSteps)
    .where(
      and(
        eq(onboardingSteps.organizationId, actor.organizationId),
        eq(onboardingSteps.versionId, template.versionId),
      ),
    )
    .orderBy(asc(onboardingSteps.position))

  const sectionTitles = new Map(sections.map((s) => [s.id, s.title]))
  const assignmentId = newId()

  const dueFor = (step: { dueOffsetDays: number | null; dueOffsetBasis: string }): string | null =>
    step.dueOffsetDays === null
      ? null
      : addCalendarDays(step.dueOffsetBasis === 'hire_date' ? hireDate : start, step.dueOffsetDays)

  const dueDates = steps.map(dueFor).filter((d): d is string => d !== null)
  const latestDue = dueDates.length > 0 ? [...dueDates].sort().at(-1)! : null

  await tx.insert(onboardingAssignments).values({
    id: assignmentId,
    organizationId: actor.organizationId,
    employmentId,
    templateId: template.templateId,
    templateVersionId: template.versionId,
    templateVersionNumber: template.versionNumber,
    templateName: template.name,
    startedOn: start,
    dueOn: latestDue,
  })

  const toLink: StepToLink[] = []
  for (const step of steps) {
    const courseId = step.kind === 'training_assignment' ? step.courseId : null
    const reason = blockedReasonFor(step.kind, courseId)
    const progressId = newId()
    if (courseId) {
      toLink.push({ progressId, courseId, stepTitle: step.title, dueOn: dueFor(step) })
    }
    await tx.insert(onboardingStepProgress).values({
      id: progressId,
      courseId,
      organizationId: actor.organizationId,
      assignmentId,
      stepId: step.id,
      sectionTitle: sectionTitles.get(step.sectionId) ?? '',
      title: step.title,
      instructions: step.instructions,
      kind: step.kind,
      responsibility: step.responsibility,
      required: step.required,
      requiresManagerVerification: step.requiresManagerVerification,
      blocksCompletion: step.blocksCompletion,
      position: step.position,
      dueOn: dueFor(step),
      status: reason ? 'blocked' : 'pending',
      blockedReason: reason,
    })
  }

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.ONBOARDING_ASSIGNED,
    summary: `Started onboarding for ${person.displayName} using "${template.name}" v${template.versionNumber}`,
    subjectType: 'employment',
    subjectId: employmentId,
    locationId: person.homeLocationId,
    metadata: { assignmentId, versionId: template.versionId, steps: steps.length },
  })

  // The linked courses: assigned (or found) and pinned, now.
  await linkTrainingOnStart(tx, actor, {
    employmentId,
    locationId: person.homeLocationId,
    steps: toLink,
  })

  return assignmentId
}

function nextActionFor(steps: OnboardingStepView[]): string | null {
  // A step whose course waits for a manager's sign-off is not the person's next action.
  const waitingOnSignoff = (s: OnboardingStepView) => s.training?.state === 'awaiting_signoff'
  const pending = steps
    .filter((s) => s.status === 'pending' && !waitingOnSignoff(s))
    .sort((a, b) => a.position - b.position)
  if (pending[0]) return pending[0].title

  const actionable = steps
    .filter((s) => s.status === 'blocked' && !s.awaitingPlatform)
    .sort((a, b) => a.position - b.position)
  if (actionable[0]) return `Blocked: ${actionable[0].title}`

  const signoff = steps.filter(waitingOnSignoff).sort((a, b) => a.position - b.position)
  if (signoff[0]) return `Waiting for sign-off: ${signoff[0].title}`

  const waiting = steps.filter((s) => s.awaitingPlatform).sort((a, b) => a.position - b.position)
  if (waiting[0]) return `Waiting on EverCalm: ${waiting[0].title}`
  return null
}

export async function getProgressForEmployment(
  tx: Tx,
  actor: Actor,
  employmentId: string,
): Promise<OnboardingProgress | null> {
  // Every capability question here is scoped to the PERSON'S location, never
  // asked organization-wide - a General Manager holds these only at their own
  // site, so the org-wide form would refuse them for their own new hires.
  const [subject] = await tx
    .select({
      homeLocationId: employments.homeLocationId,
      displayName: employments.displayName,
    })
    .from(employments)
    .where(
      and(eq(employments.organizationId, actor.organizationId), eq(employments.id, employmentId)),
    )
    .limit(1)
  if (!subject) throw new NotFoundError('Employee not found')

  const subjectLocationId = subject.homeLocationId
  if (!isSelf(actor, employmentId)) {
    authorize(actor, 'onboarding.view_progress', { locationId: subjectLocationId })
  }

  const [assignment] = await tx
    .select()
    .from(onboardingAssignments)
    .where(
      and(
        eq(onboardingAssignments.organizationId, actor.organizationId),
        eq(onboardingAssignments.employmentId, employmentId),
      ),
    )
    .limit(1)
  if (!assignment) return null

  const rows = await tx
    .select()
    .from(onboardingStepProgress)
    .where(
      and(
        eq(onboardingStepProgress.organizationId, actor.organizationId),
        eq(onboardingStepProgress.assignmentId, assignment.id),
      ),
    )
    .orderBy(asc(onboardingStepProgress.position))

  const people = await tx
    .select({ id: employments.id, displayName: employments.displayName })
    .from(employments)
    .where(eq(employments.organizationId, actor.organizationId))
  const nameOf = new Map(people.map((p) => [p.id, p.displayName]))

  const mayVerify = can(actor, 'onboarding.verify', { locationId: subjectLocationId })
  const viewingSelf = isSelf(actor, employmentId)
  const training = await linkedTrainingViews(tx, actor.organizationId, rows)

  const steps: OnboardingStepView[] = rows.map((r) => {
    const managerRequired = needsManagerToComplete(r)
    return {
      id: r.id,
      stepId: r.stepId,
      sectionTitle: r.sectionTitle,
      title: r.title,
      instructions: r.instructions,
      kind: r.kind,
      responsibility: r.responsibility,
      required: r.required,
      requiresManagerVerification: r.requiresManagerVerification,
      blocksCompletion: r.blocksCompletion,
      status: r.status,
      position: r.position,
      dueOn: r.dueOn,
      note: r.note,
      blockedReason: displayReason(r.blockedReason),
      completedAt: r.completedAt,
      completedBy: r.completedByEmploymentId
        ? (nameOf.get(r.completedByEmploymentId) ?? null)
        : null,
      verifiedBy: r.verifiedByEmploymentId ? (nameOf.get(r.verifiedByEmploymentId) ?? null) : null,
      // The employee may complete their own ordinary steps, never one a
      // manager has to confirm.
      // A training step completes with its course, never by hand.
      selfCompletable:
        viewingSelf &&
        r.status === 'pending' &&
        !managerRequired &&
        r.kind !== 'training_assignment',
      awaitingVerification:
        mayVerify && r.status === 'pending' && managerRequired && r.kind !== 'training_assignment',
      awaitingPlatform: r.status === 'blocked' && UNRESOLVED_KINDS.has(r.kind),
      training: training.get(r.id) ?? null,
    }
  })

  const gating = steps.filter((s) => s.required && s.blocksCompletion)
  const gatingDone = gating.filter((s) => s.status === 'completed' || s.status === 'waived').length

  return {
    assignmentId: assignment.id,
    employmentId,
    employeeName: subject.displayName,
    templateName: assignment.templateName,
    templateVersionNumber: assignment.templateVersionNumber,
    startedOn: assignment.startedOn,
    dueOn: assignment.dueOn,
    completedAt: assignment.completedAt,
    state: deriveState(steps, assignment.completedAt),
    requiredTotal: gating.length,
    requiredDone: gatingDone,
    percentComplete: gating.length === 0 ? 100 : Math.round((gatingDone / gating.length) * 100),
    nextAction: nextActionFor(steps),
    steps,
  }
}

/**
 * Everyone currently onboarding, for the administration dashboard.
 *
 * A location-scoped manager sees only their own site's new hires: the
 * capability is checked per person, and anyone they cannot see is silently
 * omitted rather than erroring the whole page.
 */
export async function listProgress(tx: Tx, actor: Actor): Promise<OnboardingProgress[]> {
  if (!canAtAnyLocation(actor, 'onboarding.view_progress')) {
    throw new ForbiddenError('onboarding.view_progress')
  }

  const assignments = await tx
    .select({ employmentId: onboardingAssignments.employmentId })
    .from(onboardingAssignments)
    .where(eq(onboardingAssignments.organizationId, actor.organizationId))

  const results: OnboardingProgress[] = []
  for (const a of assignments) {
    try {
      const progress = await getProgressForEmployment(tx, actor, a.employmentId)
      if (progress) results.push(progress)
    } catch (error) {
      if (!(error instanceof ForbiddenError)) throw error
    }
  }

  const order: Record<OnboardingState, number> = {
    blocked: 0,
    overdue: 1,
    in_progress: 2,
    not_started: 3,
    completed: 4,
  }
  return results.sort((a, b) => order[a.state] - order[b.state])
}

export async function completeStep(
  tx: Tx,
  actor: Actor,
  stepProgressId: string,
  note?: string,
): Promise<void> {
  const [row] = await tx
    .select()
    .from(onboardingStepProgress)
    .where(
      and(
        eq(onboardingStepProgress.organizationId, actor.organizationId),
        eq(onboardingStepProgress.id, stepProgressId),
      ),
    )
    .limit(1)
  if (!row) throw new NotFoundError('Onboarding step not found')

  const [assignment] = await tx
    .select({
      employmentId: onboardingAssignments.employmentId,
      id: onboardingAssignments.id,
    })
    .from(onboardingAssignments)
    .where(
      and(
        eq(onboardingAssignments.organizationId, actor.organizationId),
        eq(onboardingAssignments.id, row.assignmentId),
      ),
    )
    .limit(1)
  if (!assignment) throw new NotFoundError('Onboarding not found')

  const locationId = await subjectLocation(tx, actor, assignment.employmentId)
  const managerRequired = needsManagerToComplete(row)

  if (managerRequired) {
    // The rule that makes manager verification meaningful: the employee can
    // never sign off their own, and the verifier is recorded by name.
    authorize(actor, 'onboarding.verify', { locationId })
    if (isSelf(actor, assignment.employmentId)) {
      throw new ValidationError(
        {},
        'This step has to be confirmed by a manager, not by the person completing it.',
      )
    }
  } else if (!isSelf(actor, assignment.employmentId)) {
    authorize(actor, 'onboarding.verify', { locationId })
  }

  if (row.kind === 'training_assignment') {
    throw new ValidationError(
      {},
      'This step completes itself when the linked course is finished in Training.',
    )
  }
  if (row.status === 'blocked') {
    throw new ValidationError(
      {},
      displayReason(row.blockedReason) ??
        'This step is waiting on something else and cannot be completed yet.',
    )
  }
  if (row.status === 'completed') return

  await tx
    .update(onboardingStepProgress)
    .set({
      status: 'completed',
      note: note?.trim() || row.note,
      completedAt: new Date(),
      completedByEmploymentId: actor.employmentId,
      verifiedAt: managerRequired ? new Date() : row.verifiedAt,
      verifiedByEmploymentId: managerRequired ? actor.employmentId : row.verifiedByEmploymentId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(onboardingStepProgress.organizationId, actor.organizationId),
        eq(onboardingStepProgress.id, stepProgressId),
      ),
    )

  await recordAuditEvent(tx, actor, {
    action: managerRequired
      ? AUDIT_ACTIONS.ONBOARDING_STEP_VERIFIED
      : AUDIT_ACTIONS.ONBOARDING_STEP_COMPLETED,
    summary: managerRequired
      ? `Verified "${row.title}"`
      : `Completed onboarding step "${row.title}"`,
    subjectType: 'employment',
    subjectId: assignment.employmentId,
    metadata: { stepProgressId, kind: row.kind },
  })

  const { justCompleted: finished } = await refreshOnboardingCompletion(
    tx,
    actor.organizationId,
    assignment.id,
  )
  if (finished) {
    await recordAuditEvent(tx, actor, {
      action: AUDIT_ACTIONS.ONBOARDING_COMPLETED,
      summary: `Onboarding complete`,
      subjectType: 'employment',
      subjectId: assignment.employmentId,
    })
  }
}

/** Flag a step as blocked, with a reason the manager can act on. */
export async function blockStep(
  tx: Tx,
  actor: Actor,
  stepProgressId: string,
  reason: string,
): Promise<void> {
  const [row] = await tx
    .select()
    .from(onboardingStepProgress)
    .where(
      and(
        eq(onboardingStepProgress.organizationId, actor.organizationId),
        eq(onboardingStepProgress.id, stepProgressId),
      ),
    )
    .limit(1)
  if (!row) throw new NotFoundError('Onboarding step not found')

  const [assignment] = await tx
    .select({ employmentId: onboardingAssignments.employmentId })
    .from(onboardingAssignments)
    .where(
      and(
        eq(onboardingAssignments.organizationId, actor.organizationId),
        eq(onboardingAssignments.id, row.assignmentId),
      ),
    )
    .limit(1)
  if (!assignment) throw new NotFoundError('Onboarding not found')

  if (!isSelf(actor, assignment.employmentId)) {
    authorize(actor, 'onboarding.verify', {
      locationId: await subjectLocation(tx, actor, assignment.employmentId),
    })
  }

  if (reason.trim().length < 3) {
    throw new ValidationError({ reason: ['Say what is blocking this step.'] }, 'Reason required')
  }

  await tx
    .update(onboardingStepProgress)
    .set({ status: 'blocked', blockedReason: reason.trim(), updatedAt: new Date() })
    .where(
      and(
        eq(onboardingStepProgress.organizationId, actor.organizationId),
        eq(onboardingStepProgress.id, stepProgressId),
      ),
    )

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.ONBOARDING_STEP_BLOCKED,
    summary: `Flagged "${row.title}" as blocked`,
    subjectType: 'employment',
    subjectId: assignment.employmentId,
    metadata: { stepProgressId, reason: reason.trim() },
  })
}

export interface PreviewSection {
  sectionTitle: string
  steps: OnboardingStepView[]
}

/**
 * What a new hire would see, built from a template version WITHOUT creating an
 * assignment. Used by the authoring screen so an administrator can check their
 * work before publishing.
 */
export async function previewVersion(
  tx: Tx,
  actor: Actor,
  versionId: string,
  startedOn?: string,
): Promise<PreviewSection[]> {
  authorize(actor, 'onboarding.manage')

  const sections = await tx
    .select()
    .from(onboardingSections)
    .where(
      and(
        eq(onboardingSections.organizationId, actor.organizationId),
        eq(onboardingSections.versionId, versionId),
      ),
    )
    .orderBy(asc(onboardingSections.position))

  const steps = await tx
    .select()
    .from(onboardingSteps)
    .where(
      and(
        eq(onboardingSteps.organizationId, actor.organizationId),
        eq(onboardingSteps.versionId, versionId),
      ),
    )
    .orderBy(asc(onboardingSteps.position))

  const start = startedOn ?? today()
  const courseTitles = await linkedCourseTitles(
    tx,
    actor.organizationId,
    steps.map((s) => s.courseId),
  )

  return sections.map((section) => ({
    sectionTitle: section.title,
    steps: steps
      .filter((s) => s.sectionId === section.id)
      .map((s) => {
        const reason = blockedReasonFor(s.kind, s.courseId)
        return {
          id: s.id,
          stepId: s.id,
          sectionTitle: section.title,
          title: s.title,
          instructions: s.instructions,
          kind: s.kind,
          responsibility: s.responsibility,
          required: s.required,
          requiresManagerVerification: s.requiresManagerVerification,
          blocksCompletion: s.blocksCompletion,
          status: reason ? 'blocked' : 'pending',
          position: s.position,
          dueOn: s.dueOffsetDays === null ? null : addCalendarDays(start, s.dueOffsetDays),
          note: null,
          blockedReason: reason,
          completedAt: null,
          completedBy: null,
          verifiedBy: null,
          // In a preview the viewer stands in for the new hire.
          selfCompletable:
            reason === null && !needsManagerToComplete(s) && s.kind !== 'training_assignment',
          awaitingVerification: false,
          awaitingPlatform: reason !== null && UNRESOLVED_KINDS.has(s.kind),
          training:
            s.kind === 'training_assignment' && s.courseId
              ? {
                  courseId: s.courseId,
                  courseTitle: courseTitles.get(s.courseId) ?? 'Training',
                  assignmentId: null,
                  versionNumber: null,
                  state: 'not_started' as const,
                  completedLessons: 0,
                  totalLessons: 0,
                  percent: 0,
                  nextLessonId: null,
                }
              : null,
        }
      }),
  }))
}
