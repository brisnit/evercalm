import type { Metadata } from 'next'
import { requireActorContext } from '@/server/auth/session'
import { can } from '@/server/authz/can'
import { Card, PageHeader } from '@/ui/primitives'
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
    <>
      <PageHeader
        back={{ href: '/app/training', label: 'Courses' }}
        title="New course"
        description="Start with a title. You add lessons next, preview it as an employee sees it, and publish when it is ready. Nobody sees a draft."
      />
      <div className="mx-auto max-w-2xl py-7">
        <Card className="p-5">
          <NewCourseForm />
        </Card>
      </div>
    </>
  )
}
