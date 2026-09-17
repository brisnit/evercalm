import Link from 'next/link'
import { cn } from '@/lib/cn'
import { BackLink } from '@/ui/primitives'

/** Content, people, preview: the three things you do with one course. */
export function CourseTabs({
  courseId,
  current,
  showPeople,
}: {
  courseId: string
  current: 'content' | 'people' | 'preview'
  showPeople: boolean
}) {
  const tabs = [
    { key: 'content', href: `/app/training/courses/${courseId}`, label: 'Content' },
    ...(showPeople
      ? [{ key: 'people', href: `/app/training/courses/${courseId}/people`, label: 'People' }]
      : []),
    { key: 'preview', href: `/app/training/courses/${courseId}/preview`, label: 'Preview' },
  ]
  return (
    <nav aria-label="Course" className="border-line mb-6 border-b">
      <ul className="-mb-px flex flex-wrap gap-x-1">
        {tabs.map((tab) => (
          <li key={tab.key}>
            <Link
              href={tab.href}
              aria-current={current === tab.key ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-11 items-center border-b-2 px-3 text-sm whitespace-nowrap',
                current === tab.key
                  ? 'text-ink border-teal-600 font-semibold'
                  : 'text-muted hover:text-ink hover:border-line-strong border-transparent',
              )}
            >
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export function Breadcrumb({ href, label }: { href: string; label: string }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-3">
      <BackLink href={href}>{label}</BackLink>
    </nav>
  )
}
