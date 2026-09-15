const DATE = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
})
const TIME = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'UTC',
})

/** Staff see one clock: UTC, labelled, so times across customers compare. */
export function utcDate(d: Date | null): string {
  return d ? DATE.format(d) : '—'
}

export function utcDateTime(d: Date | null): string {
  return d ? `${DATE.format(d)}, ${TIME.format(d)} UTC` : '—'
}

export const SUBSCRIPTION_LABELS: Record<
  string,
  { label: string; tone: 'success' | 'info' | 'warning' | 'danger' | 'neutral' }
> = {
  trialing: { label: 'Trial', tone: 'info' },
  active: { label: 'Active', tone: 'success' },
  past_due: { label: 'Payment overdue', tone: 'warning' },
  suspended: { label: 'Suspended', tone: 'danger' },
  canceled: { label: 'Canceled', tone: 'neutral' },
}

export const CASE_STATUS_LABELS: Record<
  string,
  { label: string; tone: 'info' | 'violet' | 'warning' | 'success' }
> = {
  open: { label: 'Needs EverCalm', tone: 'info' },
  in_progress: { label: 'In progress', tone: 'violet' },
  waiting_on_customer: { label: 'Waiting on customer', tone: 'warning' },
  resolved: { label: 'Resolved', tone: 'success' },
}

export const SEVERITY_TONES: Record<string, 'neutral' | 'info' | 'warning' | 'danger'> = {
  low: 'neutral',
  normal: 'info',
  high: 'warning',
  urgent: 'danger',
}
