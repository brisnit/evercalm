import type { EmploymentStatus } from './schema'

/** Employment status as people read it. Never render the stored value. */
export const EMPLOYMENT_STATUS_LABELS: Record<EmploymentStatus, string> = {
  invited: 'Invited',
  active: 'Active',
  suspended: 'Access suspended',
  separated: 'No longer employed',
}

export function employmentStatusLabel(status: string): string {
  return EMPLOYMENT_STATUS_LABELS[status as EmploymentStatus] ?? status
}

/** Onboarding progress states as people read them. */
export const ONBOARDING_STATE_LABELS: Record<string, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  blocked: 'Blocked',
  overdue: 'Overdue',
  completed: 'Complete',
}
