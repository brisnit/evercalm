import type { Metadata } from 'next'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { can } from '@/server/authz/can'
import { COURSE_LIBRARY } from '@/modules/training/library'
import { getOrganization } from '@/modules/org/service'
import { LESSON_KIND_LABELS } from '@/modules/training/content'
import { Badge, ButtonLink, Card, CardHeader, PageHeader } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { NoticeProvider } from '@/ui/patterns/notice-provider'
import { AdoptButton } from './adopt-button'

export const metadata: Metadata = { title: 'Course library' }
export const dynamic = 'force-dynamic'

/**
 * Courses a manager does not have to write.
 *
 * Adopting one creates a real draft here, in this organization, which the
 * manager then edits in their own words. Nothing is linked or borrowed: after
 * they publish it, it is theirs.
 */
export default async function LibraryPage() {
  const { actor } = await requireActorContext()
  if (!can(actor, 'training.author')) {
    return <PermissionDenied capabilityLabel="Author training" />
  }

  const profile = await withTenant(actor.organizationId, (tx) =>
    getOrganization(tx, actor).catch(() => null),
  )
  const industry = profile?.industry ?? 'any'
  const relevant = COURSE_LIBRARY.filter((c) => c.industry === industry || c.industry === 'any')
  const rest = COURSE_LIBRARY.filter((c) => !relevant.includes(c))

  return (
    <>
      <PageHeader
        back={{ href: '/app/training', label: 'Courses' }}
        title="Start from"
        accent="something written"
        description="Ready-made courses you can take, edit in your own words and publish under your own name. They arrive as drafts — nobody sees them until you say so."
        action={
          <ButtonLink href="/app/training/import" variant="secondary" size="lg">
            Import what you already have
          </ButtonLink>
        }
      />

      <div className="flex flex-col gap-8 py-7">
        <NoticeProvider>
          <Section title="For your business" courses={relevant} />
          {rest.length > 0 ? <Section title="Other industries" courses={rest} /> : null}
        </NoticeProvider>
      </div>
    </>
  )
}

function Section({ title, courses }: { title: string; courses: typeof COURSE_LIBRARY }) {
  if (courses.length === 0) return null
  return (
    <section>
      <h2 className="font-display text-muted mb-3 text-sm font-bold tracking-[0.06em] uppercase">
        {title} · {courses.length}
      </h2>
      <div className="grid gap-4 lg:grid-cols-2">
        {courses.map((course) => (
          <Card key={course.key} className="flex h-full flex-col">
            <CardHeader title={course.title} description={course.summary} />
            <div className="flex flex-1 flex-col justify-between gap-4 p-5">
              <div>
                <p className="text-muted mb-3 text-sm italic">{course.why}</p>
                <ol className="flex flex-col gap-1.5">
                  {course.lessons.map((lesson, index) => (
                    <li key={lesson.title} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-faint tabular-nums">{index + 1}.</span>
                      <span className="text-ink">{lesson.title}</span>
                      <Badge tone="neutral">{LESSON_KIND_LABELS[lesson.kind]}</Badge>
                      <span className="text-faint text-xs tabular-nums">{lesson.minutes} min</span>
                    </li>
                  ))}
                </ol>
              </div>
              <AdoptButton courseKey={course.key} title={course.title} />
            </div>
          </Card>
        ))}
      </div>
    </section>
  )
}
