import type { Metadata } from 'next'
import Link from 'next/link'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { listTemplates } from '@/modules/onboarding/templates'
import { canAtAnyLocation } from '@/server/authz/can'
import { ForbiddenError } from '@/lib/errors'
import { Badge, Card, EmptyState, PageHeader } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { NewTemplateForm } from './new-template-form'

export const metadata: Metadata = { title: 'Onboarding checklists' }
export const dynamic = 'force-dynamic'

/**
 * Checklist list.
 *
 * Status is the most important column: a draft cannot be assigned to anyone,
 * and that has to be obvious at a glance rather than discovered when a new
 * hire gets nothing.
 */
export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>
}) {
  const { actor } = await requireActorContext()
  if (!canAtAnyLocation(actor, 'onboarding.manage')) {
    return <PermissionDenied capabilityLabel="Manage onboarding checklists" />
  }

  const showArchived = (await searchParams).archived === '1'

  const templates = await withTenant(actor.organizationId, async (tx) => {
    try {
      return await listTemplates(tx, actor, { includeArchived: showArchived })
    } catch (error) {
      if (error instanceof ForbiddenError) return null
      throw error
    }
  })
  if (!templates) return <PermissionDenied capabilityLabel="Manage onboarding checklists" />

  const live = templates.filter((t) => t.archivedAt === null)
  const archived = templates.filter((t) => t.archivedAt !== null)
  const shown = showArchived ? templates : live

  return (
    <>
      <PageHeader
        eyebrow="Onboarding"
        title="Checklists"
        description="What a new hire works through in their first weeks. Only published checklists can be assigned."
        action={
          <Link
            href={
              showArchived ? '/app/onboarding/templates' : '/app/onboarding/templates?archived=1'
            }
            className="rounded-control border-line-strong text-ink hover:bg-sunk inline-flex min-h-11 items-center border px-4 text-sm font-medium"
          >
            {showArchived
              ? 'Hide archived'
              : `Show archived${archived.length ? ` (${archived.length})` : ''}`}
          </Link>
        }
      />

      {shown.length === 0 ? (
        <EmptyState
          title="No checklists yet"
          description="Build one so every new hire gets the same start, and their manager can see where they are."
        />
      ) : (
        <ul className="mb-8 flex flex-col gap-3">
          {shown.map((template) => (
            <li key={template.id}>
              <Card className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/app/onboarding/templates/${template.id}`}
                        className="font-display text-ink text-base font-bold underline-offset-4 hover:underline"
                      >
                        {template.name}
                      </Link>
                      <StatusBadge
                        status={template.status}
                        archived={template.archivedAt !== null}
                      />
                      {template.isDefault ? <Badge tone="violet">Default</Badge> : null}
                      {template.hasDraft && template.status === 'published' ? (
                        <Badge tone="warning">
                          Draft v{template.draftVersionNumber} in progress
                        </Badge>
                      ) : null}
                    </div>

                    {template.description ? (
                      <p className="text-muted mt-1.5 text-sm">{template.description}</p>
                    ) : null}

                    <dl className="text-muted mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs">
                      <div className="flex gap-1.5">
                        <dt>Steps</dt>
                        <dd className="text-ink font-medium tabular-nums">{template.stepCount}</dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt>Published</dt>
                        <dd className="text-ink font-medium">
                          {template.publishedVersionNumber
                            ? `v${template.publishedVersionNumber}`
                            : 'Never'}
                        </dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt>In use by</dt>
                        <dd className="text-ink font-medium tabular-nums">
                          {template.assignedCount}
                        </dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt>Applies to</dt>
                        <dd className="text-ink font-medium">
                          {template.jobRoleNames.length === 0 && template.locationNames.length === 0
                            ? template.isDefault
                              ? 'Anyone without a closer match'
                              : 'Nobody yet'
                            : [...template.jobRoleNames, ...template.locationNames].join(', ')}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  <Link
                    href={`/app/onboarding/templates/${template.id}`}
                    className="rounded-control border-line-strong text-ink hover:bg-sunk inline-flex min-h-11 items-center border px-4 text-sm font-medium"
                  >
                    {template.archivedAt ? 'View' : 'Edit'}
                  </Link>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Card>
        <div className="p-5">
          <h2 className="font-display text-ink text-base font-bold">Create a checklist</h2>
          <p className="text-muted mt-1 mb-4 text-sm">
            It starts as a draft, so nobody can be assigned it until you publish.
          </p>
          <NewTemplateForm />
        </div>
      </Card>
    </>
  )
}

function StatusBadge({ status, archived }: { status: string; archived: boolean }) {
  if (archived) return <Badge tone="neutral">Archived</Badge>
  if (status === 'published') return <Badge tone="success">Published</Badge>
  return <Badge tone="warning">Draft — cannot be assigned</Badge>
}
