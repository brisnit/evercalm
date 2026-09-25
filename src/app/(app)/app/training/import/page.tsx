import type { Metadata } from 'next'
import { requireActorContext } from '@/server/auth/session'
import { can } from '@/server/authz/can'
import { Card, CardHeader, PageHeader } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { NoticeProvider } from '@/ui/patterns/notice-provider'
import { ImportForm } from './import-form'

export const metadata: Metadata = { title: 'Import a course' }
export const dynamic = 'force-dynamic'

/**
 * Turn a policy you already have into a course.
 *
 * Most operators do not need training written — they need the handbook that
 * already exists in a shared drive to become something they can assign, and
 * show that somebody read.
 */
export default async function ImportPage() {
  const { actor } = await requireActorContext()
  if (!can(actor, 'training.author')) {
    return <PermissionDenied capabilityLabel="Author training" />
  }

  return (
    <>
      <PageHeader
        back={{ href: '/app/training/library', label: 'Library' }}
        title="Import what"
        accent="you already have"
        description="Paste your handbook, SOP or policy. Each section becomes a reading lesson you can edit, reorder and publish."
      />
      <div className="py-7">
        <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr] lg:items-start">
          <Card>
            <CardHeader title="Paste the document" />
            <div className="p-5">
              <NoticeProvider>
                <ImportForm />
              </NoticeProvider>
            </div>
          </Card>

          <Card>
            <CardHeader title="How it splits" />
            <div className="flex flex-col gap-3 p-5 text-sm">
              <p className="text-muted">
                A short line on its own becomes a lesson title. The paragraphs under it become that
                lesson’s body. Blank lines separate paragraphs.
              </p>
              <pre className="rounded-control border-line text-muted overflow-x-auto border bg-white p-3 text-xs">
                {`Closing the bar

Count the drawer with a second person
present, and sign the sheet.

Locking up

Check the back door, the walk-in and
the gas before setting the alarm.`}
              </pre>
              <p className="text-muted">
                That becomes two lessons: “Closing the bar” and “Locking up”. You can rename,
                reorder or change any of them afterwards.
              </p>
              <p className="text-faint">
                Uploading a PDF or Word file needs file storage and text extraction, which is on the
                list of what production still requires.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </>
  )
}
