import type { Metadata } from 'next'
import Link from 'next/link'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { canAtAnyLocation } from '@/server/authz/can'
import { canUseOperationsAdmin } from '@/modules/operations/access'
import { OPS_KIND_LABELS } from '@/modules/operations/rules'
import { listTemplates, type TemplateSummary } from '@/modules/operations/templates'
import { Badge, Card, EmptyState, PageHeader } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { LINK_BUTTON_CLASS } from '../../training/_components/styles'

export const metadata: Metadata = { title: 'Operations templates' }
export const dynamic = 'force-dynamic'

export function targetSummary(t: Pick<TemplateSummary, 'targetNames'>): string {
  const where = t.targetNames.locations.length
    ? t.targetNames.locations.map((l) => l.name).join(', ')
    : 'Every location'
  const who = t.targetNames.jobRoles.map((r) => r.name)
  const stations = t.targetNames.stations.map((s) => s.name)
  return [
    where,
    who.length ? who.join(', ') : 'any role',
    stations.length ? stations.join(', ') : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * The work each kind of shift carries: pre-shift, opening, side work,
 * station setup, shift duties, closing and handoff templates.
 */
export default async function OperationsTemplatesPage() {
  const { actor } = await requireActorContext()
  if (!canUseOperationsAdmin(actor)) return <PermissionDenied capabilityLabel="Author checklists" />

  const templates = await withTenant(actor.organizationId, (tx) => listTemplates(tx, actor))
  const active = templates.filter((t) => t.status === 'active')
  const archived = templates.filter((t) => t.status === 'archived')
  const canAuthor = canAtAnyLocation(actor, 'checklist.author')

  return (
    <>
      <PageHeader
        title="Templates"
        description="The duties a shift carries. Publish a template and every matching published shift gets its tasks; editing starts a new version, and shifts already under way keep the one they were given."
        action={
          canAuthor ? (
            <Link href="/app/operations/templates/new" className={LINK_BUTTON_CLASS}>
              New template
            </Link>
          ) : null
        }
      />
      {active.length === 0 ? (
        <EmptyState
          title="No templates yet"
          description={
            canAuthor
              ? 'Start with the work that is easiest to forget: side work, closing duties, or the handoff at the end of the night.'
              : 'Nobody has published operational templates for your locations yet.'
          }
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {active.map((t) => (
            <li key={t.id}>
              <TemplateCard template={t} />
            </li>
          ))}
        </ul>
      )}
      {archived.length > 0 ? (
        <section aria-labelledby="archived-heading" className="mt-8">
          <h2 id="archived-heading" className="font-display text-ink text-lg font-bold">
            Archived
          </h2>
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {archived.map((t) => (
              <li key={t.id}>
                <TemplateCard template={t} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  )
}

function TemplateCard({ template: t }: { template: TemplateSummary }) {
  return (
    <Card className="h-full p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral">{OPS_KIND_LABELS[t.kind]}</Badge>
        {t.status === 'archived' ? (
          <Badge tone="neutral">Archived</Badge>
        ) : t.publishedVersionNumber ? (
          <Badge tone="success">Version {t.publishedVersionNumber}</Badge>
        ) : (
          <Badge tone="warning">Not published</Badge>
        )}
        {t.draftVersionNumber && t.publishedVersionNumber ? (
          <Badge tone="accent">Draft {t.draftVersionNumber}</Badge>
        ) : null}
      </div>
      <h3 className="font-display text-ink mt-2 text-base font-bold">
        <Link
          href={`/app/operations/templates/${t.id}`}
          className="underline-offset-4 hover:underline"
        >
          {t.name}
        </Link>
      </h3>
      <p className="text-muted mt-1 text-sm">{targetSummary(t)}</p>
      <p className="text-faint mt-1 text-xs">
        {t.taskCount} {t.taskCount === 1 ? 'task' : 'tasks'}
        {t.canEdit ? '' : ' · view only'}
      </p>
    </Card>
  )
}
