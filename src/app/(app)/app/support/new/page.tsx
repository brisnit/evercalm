import type { Metadata } from 'next'
import { requireActorContext } from '@/server/auth/session'
import { can } from '@/server/authz/can'
import { CATEGORY_LABELS, SEVERITY_LABELS } from '@/modules/support/service'
import { BackLink, Card, PageHeader } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { NewCaseForm } from './new-case-form'

export const metadata: Metadata = { title: 'Open a support case' }
export const dynamic = 'force-dynamic'

export default async function NewSupportCasePage() {
  const { actor } = await requireActorContext()
  if (!can(actor, 'support.manage'))
    return <PermissionDenied capabilityLabel="Contact EverCalm support" />
  return (
    <>
      <BackLink href="/app/support">Support</BackLink>
      <PageHeader
        title="Open a support case"
        description="The EverCalm team replies here and in your notifications."
      />
      <Card className="max-w-2xl p-5">
        <NewCaseForm
          categories={Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label }))}
          severities={Object.entries(SEVERITY_LABELS).map(([value, s]) => ({
            value,
            label: `${s.label}: ${s.hint}`,
          }))}
        />
      </Card>
    </>
  )
}
