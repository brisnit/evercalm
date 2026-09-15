import type { Metadata } from 'next'
import { requireActorContext } from '@/server/auth/session'
import { can } from '@/server/authz/can'
import { BackLink, Card, PageHeader } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { NewCourseForm } from './new-course-form'

export const metadata: Metadata = { title: 'New course' }
export const dynamic = 'force-dynamic'

export default async function NewCoursePage() {
  const { actor } = await requireActorContext()
  if (!can(actor, 'training.author')) {
    return <PermissionDenied capabilityLabel="Author training" />
  }

  return (
    <div className="mx-auto max-w-2xl">
      <nav aria-label="Breadcrumb" className="mb-3">
        <BackLink href="/app/training">Courses</BackLink>
      </nav>
      <PageHeader
        title="New course"
        description="Start with a title. You add lessons next, preview it as an employee sees it, and publish when it is ready. Nobody sees a draft."
      />
      <Card className="p-5">
        <NewCourseForm />
      </Card>
    </div>
  )
}
