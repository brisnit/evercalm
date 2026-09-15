import type { Metadata } from 'next'
import Link from 'next/link'
import { requirePlatformStaff } from '@/server/auth/platform-staff'
import { staffCases } from '@/server/db/platform'
import { cn } from '@/lib/cn'
import { Badge, Card, EmptyState, PageHeader } from '@/ui/primitives'
import { CASE_STATUS_LABELS, SEVERITY_TONES, utcDateTime } from '../format'

export const metadata: Metadata = { title: 'Support cases' }

export default async function PlatformSupportPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>
}) {
  const { view } = await searchParams
  const staff = await requirePlatformStaff('support')
  const all = view === 'all'
  const cases = await staffCases(staff.userId, { openOnly: !all })
  const tab = (key: string, label: string, active: boolean) => (
    <Link
      href={key === 'all' ? '/platform/support?view=all' : '/platform/support'}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'inline-flex min-h-11 items-center border-b-2 px-3 text-sm',
        active
          ? 'text-ink border-violet-600 font-semibold'
          : 'text-muted hover:text-ink border-transparent',
      )}
    >
      {label}
    </Link>
  )
  return (
    <>
      <PageHeader
        eyebrow="EverCalm team"
        title="Support cases"
        description="Most severe first, then most recently updated. Times are UTC."
      />
      <nav aria-label="Case filter" className="border-line mb-4 border-b">
        <div className="-mb-px flex gap-1">
          {tab('open', 'Open', !all)}
          {tab('all', 'All', all)}
        </div>
      </nav>
      {cases.length === 0 ? (
        <EmptyState
          title="No cases"
          description={all ? 'No customer has opened a case yet.' : 'Every case is resolved.'}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {cases.map((c) => (
            <li key={c.id}>
              <Card className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-faint text-xs font-semibold">
                      {c.reference} · {c.organizationName}
                    </p>
                    <h2 className="text-ink font-semibold">
                      <Link
                        href={`/platform/support/${c.id}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {c.subject}
                      </Link>
                    </h2>
                    <p className="text-muted text-sm">
                      {c.category.replace(/_/g, ' ')} ·{' '}
                      {c.assignedStaffLabel ? `assigned to ${c.assignedStaffLabel}` : 'unassigned'}{' '}
                      · updated {utcDateTime(c.updatedAt)}
                    </p>
                  </div>
                  <span className="flex gap-2">
                    <Badge tone={SEVERITY_TONES[c.severity] ?? 'neutral'}>{c.severity}</Badge>
                    <Badge tone={CASE_STATUS_LABELS[c.status]?.tone ?? 'info'}>
                      {CASE_STATUS_LABELS[c.status]?.label ?? c.status}
                    </Badge>
                  </span>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
