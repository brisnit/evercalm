import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { formatDateInZone } from '@/lib/dates'
import { NotFoundError } from '@/lib/errors'
import { isUuid } from '@/lib/uuid'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { canUseOperationsAdmin } from '@/modules/operations/access'
import { describeTiming, OPS_KIND_LABELS, RESPONSE_TYPE_LABELS } from '@/modules/operations/rules'
import { OPS_RESPONSE_TYPES, OPS_TEMPLATE_KINDS } from '@/modules/operations/rules'
import {
  draftProblems,
  getTemplate,
  templateOptions,
  type TemplateVersionDetail,
} from '@/modules/operations/templates'
import { organizationTimeZone } from '@/modules/training/records'
import { Badge, PageHeader } from '@/ui/primitives'
import { targetSummary } from '../page'
import { TemplateBuilder, type VersionView } from './template-builder'

export const metadata: Metadata = { title: 'Template' }
export const dynamic = 'force-dynamic'

/**
 * One operational template: the draft being built, the published version
 * shifts receive, and every version before it.
 */
export default async function TemplatePage({
  params,
}: {
  params: Promise<{ templateId: string }>
}) {
  const { templateId } = await params
  if (!isUuid(templateId)) notFound()
  const { actor } = await requireActorContext()
  if (!canUseOperationsAdmin(actor)) notFound()

  const data = await withTenant(actor.organizationId, async (tx) => {
    try {
      const template = await getTemplate(tx, actor, templateId)
      return {
        template,
        options: template.canEdit ? await templateOptions(tx, actor) : null,
        timeZone: await organizationTimeZone(tx, actor.organizationId),
      }
    } catch (error) {
      if (error instanceof NotFoundError) return null
      throw error
    }
  })
  if (!data) notFound()
  const { template, options, timeZone } = data

  const view = (v: TemplateVersionDetail): VersionView => ({
    id: v.id,
    versionNumber: v.versionNumber,
    name: v.name,
    kind: v.kind,
    kindLabel: OPS_KIND_LABELS[v.kind],
    description: v.description,
    targets: {
      locationIds: [...v.targets.locationIds],
      jobRoleIds: [...v.targets.jobRoleIds],
      stationIds: [...v.targets.stationIds],
    },
    targetLine: targetSummary(v),
    publishedLine: v.publishedAt
      ? `Published ${formatDateInZone(v.publishedAt, timeZone)}${v.publishedByName ? ` by ${v.publishedByName}` : ''}`
      : null,
    sections: v.sections.map((s) => ({
      id: s.id,
      title: s.title,
      tasks: s.tasks.map((t) => ({
        ...t,
        timingLine: describeTiming(t.timingAnchor, t.offsetMinutes),
        responseLabel: RESPONSE_TYPE_LABELS[t.responseType],
      })),
    })),
    problems: draftProblems(v.sections),
    taskCount: v.taskCount,
  })

  const shown =
    template.canEdit && template.draft ? template.draft : (template.published ?? template.draft)

  return (
    <>
      <Link
        href="/app/operations/templates"
        className="text-muted text-sm underline-offset-4 hover:underline"
      >
        ← Templates
      </Link>
      <PageHeader
        eyebrow={`Operations · ${OPS_KIND_LABELS[template.kind]}`}
        title={shown?.name ?? template.name}
        description={shown?.description || undefined}
        action={
          <div className="flex flex-wrap gap-2">
            {template.status === 'archived' ? <Badge tone="neutral">Archived</Badge> : null}
            {template.published ? (
              <Badge tone="success">Published · version {template.published.versionNumber}</Badge>
            ) : (
              <Badge tone="neutral">Not published</Badge>
            )}
          </div>
        }
      />
      <TemplateBuilder
        templateId={template.id}
        archived={template.status === 'archived'}
        canEdit={template.canEdit}
        draft={template.draft ? view(template.draft) : null}
        published={template.published ? view(template.published) : null}
        history={template.history.map((h) => ({
          id: h.id,
          versionNumber: h.versionNumber,
          isCurrent: h.id === template.published?.id,
          label: h.publishedAt
            ? `${formatDateInZone(h.publishedAt, timeZone)}${h.publishedByName ? ` · ${h.publishedByName}` : ''}`
            : '',
          changeNote: h.changeNote,
        }))}
        options={options}
        kinds={OPS_TEMPLATE_KINDS.map((k) => ({ value: k, label: OPS_KIND_LABELS[k] }))}
        responseTypes={OPS_RESPONSE_TYPES.map((r) => ({
          value: r,
          label: RESPONSE_TYPE_LABELS[r],
        }))}
      />
    </>
  )
}
