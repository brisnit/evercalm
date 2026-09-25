import type { Metadata } from 'next'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { canAtAnyLocation } from '@/server/authz/can'
import { listLocations } from '@/modules/org/service'
import {
  CATEGORY_LABELS,
  DOCUMENT_CATEGORIES,
  fileKindLabel,
  listDocuments,
  type DocumentSummary,
} from '@/modules/documents/service'
import { Badge, Card, CardHeader, EmptyState, PageHeader } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { NoticeProvider } from '@/ui/patterns/notice-provider'
import { MiniForm } from '@/ui/patterns/mini-form'
import { archiveDocumentAction } from '@/modules/documents/actions'
import { UploadForm } from './upload-form'

export const metadata: Metadata = { title: 'Documents' }
export const dynamic = 'force-dynamic'

/**
 * The document hub.
 *
 * The things an operator is asked for and cannot find, in one list, each
 * saying who it is for and where it applies. Managers add and remove; anybody
 * can open the ones marked for everyone.
 */
export default async function DocumentsPage() {
  const { actor } = await requireActorContext()
  if (!canAtAnyLocation(actor, 'people.view')) {
    return <PermissionDenied capabilityLabel="View documents" />
  }

  const { docs, locations } = await withTenant(actor.organizationId, async (tx) => ({
    docs: await listDocuments(tx, actor),
    locations: await listLocations(tx, actor).catch(() => []),
  }))

  const canManage = canAtAnyLocation(actor, 'announcement.create')
  const byCategory = DOCUMENT_CATEGORIES.map((category) => ({
    category,
    items: docs.filter((d) => d.category === category),
  })).filter((group) => group.items.length > 0)

  return (
    <>
      <PageHeader
        title="Document"
        accent="hub"
        description="The handbook, the matrix, the schedule. One place, so nobody has to ask where it is."
      />

      <div className="grid gap-5 py-7 lg:grid-cols-[1.6fr_1fr] lg:items-start">
        <div className="flex flex-col gap-6">
          {docs.length === 0 ? (
            <EmptyState
              title="Nothing here yet"
              description={
                canManage
                  ? 'Add the handbook first. It is the one people ask for most.'
                  : 'Your manager adds documents here.'
              }
            />
          ) : (
            byCategory.map((group) => (
              <section key={group.category}>
                <h2 className="font-display text-muted mb-3 text-sm font-bold tracking-[0.06em] uppercase">
                  {CATEGORY_LABELS[group.category]} · {group.items.length}
                </h2>
                <Card>
                  <ul className="divide-line divide-y">
                    {group.items.map((doc) => (
                      <li key={doc.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-2">
                            <a
                              href={`/app/documents/${doc.id}/file`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-ink font-medium underline-offset-4 hover:underline"
                            >
                              {doc.title}
                            </a>
                            {doc.visibility === 'managers' ? (
                              <Badge tone="warning">Managers only</Badge>
                            ) : null}
                            {doc.locationName ? (
                              <Badge tone="neutral">{doc.locationName}</Badge>
                            ) : null}
                          </p>
                          {doc.description ? (
                            <p className="text-muted mt-0.5 text-sm">{doc.description}</p>
                          ) : null}
                          <p className="text-faint mt-1 text-xs">{meta(doc)}</p>
                        </div>
                        {canManage ? (
                          <NoticeProvider>
                            <MiniForm
                              action={archiveDocumentAction}
                              hidden={{ documentId: doc.id }}
                              submitLabel="Remove"
                              variant="ghost"
                              size="sm"
                            />
                          </NoticeProvider>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </Card>
              </section>
            ))
          )}
        </div>

        {canManage ? (
          <Card>
            <CardHeader
              title="Add a document"
              description="PDF, image, text, Word or spreadsheet, up to 8 MB."
            />
            <div className="p-5">
              <NoticeProvider>
                <UploadForm locations={locations.map((l) => ({ id: l.id, name: l.name }))} />
              </NoticeProvider>
            </div>
          </Card>
        ) : null}
      </div>
    </>
  )
}

function meta(doc: DocumentSummary): string {
  const size =
    doc.byteSize > 1024 * 1024
      ? `${(doc.byteSize / 1024 / 1024).toFixed(1)} MB`
      : `${Math.max(1, Math.round(doc.byteSize / 1024))} KB`
  const when = doc.createdAt.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  return [
    fileKindLabel(doc.contentType),
    size,
    doc.uploadedBy ? `added by ${doc.uploadedBy}` : null,
    when,
  ]
    .filter(Boolean)
    .join(' · ')
}
