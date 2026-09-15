import type { LinkedTraining } from '@/modules/onboarding/training-link'
import { Badge, ButtonLink, ProgressBar } from '@/ui/primitives'

/**
 * A training step's course, inside the onboarding checklist.
 *
 * The step is not ticked off here: it completes with the course. So the card
 * says how the course stands and offers one way into it.
 */
export const LINKED_STATE: Record<
  LinkedTraining['state'],
  { label: string; tone: 'success' | 'violet' | 'warning' | 'info' | 'neutral' }
> = {
  not_started: { label: 'Not started', tone: 'neutral' },
  in_progress: { label: 'In progress', tone: 'info' },
  awaiting_signoff: { label: 'Waiting for sign-off', tone: 'violet' },
  completed: { label: 'Course complete', tone: 'success' },
  blocked: { label: 'Needs your manager', tone: 'warning' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
  unavailable: { label: 'Not available', tone: 'neutral' },
}

export function LinkedTrainingCard({ training }: { training: LinkedTraining }) {
  const state = LINKED_STATE[training.state]
  const open = training.assignmentId !== null && training.state !== 'withdrawn'
  const href =
    training.assignmentId && training.nextLessonId && training.state !== 'completed'
      ? `/my/training/${training.assignmentId}/lessons/${training.nextLessonId}`
      : training.assignmentId
        ? `/my/training/${training.assignmentId}`
        : null

  return (
    <div className="rounded-control border-line bg-raise mt-3 border px-3.5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-ink min-w-0 text-sm font-medium">
          <span className="text-muted block text-xs font-normal">Course</span>
          {training.courseTitle}
          {training.versionNumber !== null ? (
            <span className="text-muted font-normal"> · version {training.versionNumber}</span>
          ) : null}
        </p>
        <Badge tone={state.tone}>{state.label}</Badge>
      </div>
      {open && training.totalLessons > 0 ? (
        <ProgressBar
          className="mt-2.5"
          value={training.percent}
          label={`${training.completedLessons} of ${training.totalLessons} lessons done`}
          tone={training.state === 'completed' ? 'success' : 'violet'}
        />
      ) : null}
      {training.state === 'awaiting_signoff' ? (
        <p className="text-muted mt-2 text-sm">
          A manager will watch your practical and sign it off. This step completes when they do.
        </p>
      ) : training.state !== 'completed' && open ? (
        <p className="text-muted mt-2 text-sm">This step completes when you finish the course.</p>
      ) : null}
      {href && open ? (
        <ButtonLink
          href={href}
          variant={
            training.state === 'completed' || training.state === 'awaiting_signoff'
              ? 'secondary'
              : 'primary'
          }
          className="mt-3"
        >
          {training.state === 'completed'
            ? 'Review the course'
            : training.state === 'not_started'
              ? 'Start the course'
              : training.state === 'awaiting_signoff'
                ? 'See the course'
                : 'Continue the course'}
        </ButtonLink>
      ) : null}
    </div>
  )
}
