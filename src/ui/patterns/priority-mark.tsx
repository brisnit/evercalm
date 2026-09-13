import { cn } from '@/lib/cn'

/**
 * Priority and status marks.
 *
 * Every one carries a WORD. Colour reinforces, never carries, the meaning -
 * so the difference between urgent and normal survives a monochrome screen, a
 * colour-blind reader, and a screen reader that announces nothing about
 * styling. That is also why the shapes differ: a filled rail for urgency, an
 * outline for state.
 *
 * There is no animation and no red wash. An urgent notice earns attention by
 * staying at the top of the list until it is dealt with, which is a property
 * of the ordering rather than of the styling.
 */

const PRIORITY_STYLES: Record<string, { label: string; className: string; icon: string }> = {
  normal: { label: 'Normal', className: 'bg-sunk text-muted', icon: '' },
  important: { label: 'Important', className: 'bg-info-soft text-info', icon: '!' },
  urgent: { label: 'Urgent', className: 'bg-warning-soft text-warning', icon: '!!' },
  emergency: { label: 'Emergency', className: 'bg-danger-soft text-danger', icon: '!!!' },
}

export function PriorityMark({ priority, className }: { priority: string; className?: string }) {
  const style = PRIORITY_STYLES[priority] ?? PRIORITY_STYLES.normal!
  // Normal is the default and saying so on every row is noise.
  if (priority === 'normal') return null

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.6875rem] font-semibold',
        style.className,
        className,
      )}
    >
      {style.icon ? (
        <span aria-hidden="true" className="font-bold">
          {style.icon}
        </span>
      ) : null}
      {style.label}
    </span>
  )
}

/** The left rail that makes a pinned item scannable without relying on hue. */
export function PriorityRail({ priority }: { priority: string }) {
  if (priority !== 'urgent' && priority !== 'emergency') return null
  return (
    <span
      aria-hidden="true"
      className={cn(
        'absolute top-0 bottom-0 left-0 w-1 rounded-l-[inherit]',
        priority === 'emergency' ? 'bg-danger' : 'bg-warning',
      )}
    />
  )
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'border-line-strong text-muted',
  scheduled: 'border-info/40 text-info',
  published: 'border-success/40 text-success',
  expired: 'border-line-strong text-muted',
  archived: 'border-line-strong text-muted',
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  published: 'Active',
  expired: 'Expired',
  archived: 'Archived',
}

export function StatusMark({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-1 text-[0.6875rem] font-semibold',
        STATUS_STYLES[status] ?? STATUS_STYLES.draft,
      )}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}
