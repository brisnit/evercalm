import type { LessonState } from '@/modules/training/progress'

export const LESSON_STATE: Record<
  LessonState,
  { label: string; tone: 'success' | 'accent' | 'warning' | 'info' | 'neutral' }
> = {
  completed: { label: 'Done', tone: 'success' },
  awaiting_signoff: { label: 'Waiting for sign-off', tone: 'accent' },
  returned: { label: 'See the note', tone: 'warning' },
  in_progress: { label: 'Started', tone: 'info' },
  not_started: { label: 'To do', tone: 'neutral' },
}
