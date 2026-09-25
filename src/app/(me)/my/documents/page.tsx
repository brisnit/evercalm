import type { Metadata } from 'next'
import { EmployeeHeader, EmployeeTitle } from '../_components/employee-shell'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { CATEGORY_LABELS, fileKindLabel, listDocuments } from '@/modules/documents/service'
import { Badge, Card, EmptyState } from '@/ui/primitives'

export const metadata: Metadata = { title: 'Documents' }
export const dynamic = 'force-dynamic'

/**
 * The documents an employee can open.
 *
 * The same hub the manager fills, filtered by the visibility on each document
 * — and filtered again on the server when the file itself is requested, so a
 * guessed URL is a 404 rather than a leak.
 */
export default async function MyDocumentsPage() {
  const { actor } = await requireActorContext()
  const docs = await withTenant(actor.organizationId, (tx) => listDocuments(tx, actor))

  return (
    <div className="flex min-h-screen flex-col">
      <EmployeeHeader back={{ href: '/my', label: 'Back' }} />
      <main id="main" className="mx-auto w-full max-w-xl flex-1 px-5 pb-7">
        <EmployeeTitle
          title="Your"
          accent="documents"
          description="The handbook and everything else you might be asked to know."
        />

        <div className="mt-6 flex flex-col gap-3">
          {docs.length === 0 ? (
            <EmptyState
              title="Nothing here yet"
              description="Your manager adds documents here when there are some."
            />
          ) : (
            docs.map((doc) => (
              <Card key={doc.id}>
                <a
                  href={`/app/documents/${doc.id}/file`}
                  target="_blank"
                  rel="noreferrer"
                  className="block p-4"
                >
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="text-ink font-semibold underline-offset-4">{doc.title}</span>
                    <Badge tone="neutral">{CATEGORY_LABELS[doc.category]}</Badge>
                  </p>
                  {doc.description ? (
                    <p className="text-muted mt-1 text-sm">{doc.description}</p>
                  ) : null}
                  <p className="text-faint mt-1.5 text-xs">
                    {fileKindLabel(doc.contentType)} ·{' '}
                    {doc.byteSize > 1024 * 1024
                      ? `${(doc.byteSize / 1024 / 1024).toFixed(1)} MB`
                      : `${Math.max(1, Math.round(doc.byteSize / 1024))} KB`}
                    {doc.locationName ? ` · ${doc.locationName}` : ''}
                  </p>
                </a>
              </Card>
            ))
          )}
        </div>
      </main>
    </div>
  )
}
