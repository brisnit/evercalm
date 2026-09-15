import type { Metadata } from 'next'
import Link from 'next/link'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { canAtAnyLocation } from '@/server/authz/can'
import { templateOptions } from '@/modules/operations/templates'
import { OPS_KIND_LABELS } from '@/modules/operations/rules'
import { OPS_TEMPLATE_KINDS } from '@/modules/operations/rules'
import { Card, PageHeader } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { NewTemplateForm } from './new-template-form'

export const metadata: Metadata = { title: 'New template' }
export const dynamic = 'force-dynamic'

export default async function NewTemplatePage() {
  const { actor } = await requireActorContext()
  if (!canAtAnyLocation(actor, 'checklist.author'))
    return <PermissionDenied capabilityLabel="Author checklists" />
  const options = await withTenant(actor.organizationId, (tx) => templateOptions(tx, actor))
  return (
    <>
      <Link
        href="/app/operations/templates"
        className="text-muted text-sm underline-offset-4 hover:underline"
      >
        ← Templates
      </Link>
      <PageHeader
        eyebrow="Operations · Templates"
        title="New template"
        description="Name it and say where it applies. You add the tasks next; nothing reaches anyone until you publish."
      />
      <Card className="max-w-2xl p-5">
        <NewTemplateForm
          kinds={OPS_TEMPLATE_KINDS.map((k) => ({ value: k, label: OPS_KIND_LABELS[k] }))}
          locations={options.locations}
          mayTargetEveryLocation={options.mayTargetEveryLocation}
        />
      </Card>
    </>
  )
}
