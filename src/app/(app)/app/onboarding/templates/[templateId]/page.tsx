import type { Metadata } from 'next'
import Link from 'next/link'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { getTemplate, templateImpact } from '@/modules/onboarding/templates'
import { listJobRoles } from '@/modules/structure/service'
import { listLocations } from '@/modules/org/service'
import { canAtAnyLocation } from '@/server/authz/can'
import { ForbiddenError, NotFoundError } from '@/lib/errors'
import { Badge, Card, EmptyState, PageHeader } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { TemplateBuilder } from './builder'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ templateId: string }>
}): Promise<Metadata> {
  const { templateId } = await params
  const { actor } = await requireActorContext()
  try {
    const template = await withTenant(actor.organizationId, (tx) =>
      getTemplate(tx, actor, templateId),
    )
    return { title: template.name }
  } catch {
    return { title: 'Onboarding checklist' }
  }
}

/**
 * The checklist builder.
 *
 * Shows the DRAFT when one exists, because that is what is editable, and the
 * published version read-only alongside it. The difference is stated in words
 * rather than implied by a subtle style, since publishing is the moment a
 * change starts reaching real people.
 */
export default async function TemplateBuilderPage({
  params,
}: {
  params: Promise<{ templateId: string }>
}) {
  const { templateId } = await params
  const { actor } = await requireActorContext()
  if (!canAtAnyLocation(actor, 'onboarding.manage')) {
    return <PermissionDenied capabilityLabel="Manage onboarding checklists" />
  }

  const data = await withTenant(actor.organizationId, async (tx) => {
    try {
      return {
        template: await getTemplate(tx, actor, templateId),
        impact: await templateImpact(tx, actor, templateId),
        jobRoles: await listJobRoles(tx, actor),
        locations: await listLocations(tx, actor),
      }
    } catch (error) {
      if (error instanceof NotFoundError) return 'not_found' as const
      if (error instanceof ForbiddenError) return 'forbidden' as const
      throw error
    }
  })

  if (data === 'not_found') {
    return (
      <EmptyState
        title="We could not find that checklist"
        description="It may have been removed, or the link may be wrong."
        action={
          <Link
            href="/app/onboarding/templates"
            className="text-sm font-medium text-violet-700 underline underline-offset-4"
          >
            Back to checklists
          </Link>
        }
      />
    )
  }
  if (data === 'forbidden') {
    return <PermissionDenied capabilityLabel="Manage onboarding checklists" />
  }

  const { template } = data
  const archived = template.archivedAt !== null

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3">
        <Link
          href="/app/onboarding/templates"
          className="text-muted hover:text-ink text-sm underline-offset-4 hover:underline"
        >
          ← Checklists
        </Link>
      </nav>

      <PageHeader
        eyebrow="Onboarding checklist"
        title={template.name}
        description={template.description || undefined}
        action={
          template.publishedVersion || template.draftVersion ? (
            <Link
              href={`/app/onboarding/templates/${template.id}/preview`}
              className="rounded-control border-line-strong text-ink hover:bg-sunk inline-flex min-h-11 items-center border px-4 text-sm font-medium"
            >
              Preview as a new hire
            </Link>
          ) : undefined
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        {archived ? (
          <Badge tone="neutral">Archived</Badge>
        ) : template.status === 'published' ? (
          <Badge tone="success">Published v{template.publishedVersion?.versionNumber}</Badge>
        ) : (
          <Badge tone="warning">Draft — cannot be assigned</Badge>
        )}
        {template.isDefault ? <Badge tone="violet">Default checklist</Badge> : null}
        <span className="text-muted text-sm">
          {data.impact.activeRuns} onboarding now · {data.impact.completedRuns} completed
        </span>
      </div>

      {archived ? (
        <Card className="border-line-strong bg-sunk mb-6 p-5">
          <h2 className="font-display text-ink text-sm font-bold">This checklist is archived</h2>
          <p className="text-muted mt-1 text-sm">
            Nobody new will be assigned it. The {data.impact.activeRuns + data.impact.completedRuns}{' '}
            people who already have it keep their checklist and their history exactly as it was.
            Restore it below to use it again.
          </p>
        </Card>
      ) : null}

      <TemplateBuilder
        template={template}
        impact={data.impact}
        jobRoles={data.jobRoles.map((r) => ({ id: r.id, name: r.name }))}
        locations={data.locations.map((l) => ({ id: l.id, name: l.name }))}
      />
    </>
  )
}
