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

export const SEVERITY_LABELS: Record<string, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
}

export const PLAN_LABELS: Record<string, string> = {
  pilot: 'Pilot',
  essentials: 'Essentials',
  multi_location: 'Multi-location',
}

export const INDUSTRY_LABELS: Record<string, string> = {
  restaurant: 'Restaurant',
  salon_spa: 'Salon & spa',
  retail: 'Retail',
  fitness: 'Fitness',
  hospitality: 'Hospitality',
  field_service: 'Field service',
}

export const PROVIDER_LABELS: Record<string, string> = {
  manual: 'Manual pilot (billed by EverCalm)',
  mock: 'Test provider (development only)',
}

const titleCase = (value: string) => value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

export const labelFrom = (map: Record<string, string>, value: string | null | undefined) =>
  value ? (map[value] ?? titleCase(value)) : '—'

/** Why an organization needs the team, in words. Empty when nothing does. */
export function attentionReasons(o: {
  subscriptionStatus: string | null
  openCases: number
  failedNotifications7d: number
  publishFailures30d: number
}): { label: string; tone: 'danger' | 'warning' }[] {
  const reasons: { label: string; tone: 'danger' | 'warning' }[] = []
  if (o.subscriptionStatus === 'suspended') reasons.push({ label: 'Suspended', tone: 'danger' })
  if (o.subscriptionStatus === 'past_due')
    reasons.push({ label: 'Payment overdue', tone: 'warning' })
  if (o.failedNotifications7d > 0)
    reasons.push({ label: `${o.failedNotifications7d} failed deliveries`, tone: 'danger' })
  if (o.publishFailures30d > 0)
    reasons.push({ label: `${o.publishFailures30d} publish failures`, tone: 'danger' })
  if (o.openCases > 0)
    reasons.push({
      label: `${o.openCases} open ${o.openCases === 1 ? 'case' : 'cases'}`,
      tone: 'warning',
    })
  return reasons
}

export const SEVERITY_TONES: Record<string, 'neutral' | 'info' | 'warning' | 'danger'> = {
  low: 'neutral',
  normal: 'info',
  high: 'warning',
  urgent: 'danger',
}
