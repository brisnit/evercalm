import type { Metadata } from 'next'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { listValues } from '@/modules/structure/service'
import { can } from '@/server/authz/can'
import { Card, CardHeader, EmptyState, PageHeader } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { ValueForm } from './value-form'

export const metadata: Metadata = { title: 'Values & standards' }
export const dynamic = 'force-dynamic'

/**
 * Company values and operating standards.
 *
 * Separated on purpose. Values are what the business believes and appear in
 * onboarding; standards are what daily work is measured against and will be
 * what checklists and shift operations reference in Slice 6.
 */
export default async function ValuesPage() {
  const { actor } = await requireActorContext()
  if (!can(actor, 'org.view'))
    return <PermissionDenied capabilityLabel="View organization settings" />

  const all = await withTenant(actor.organizationId, (tx) => listValues(tx, actor))
  const values = all.filter((v) => v.kind === 'value')
  const standards = all.filter((v) => v.kind === 'standard')
  const mayEdit = can(actor, 'org.update')

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Values & standards"
        description="What the business believes, and what it expects every shift. New hires read these during onboarding."
      />

      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        <Card>
          <CardHeader title="Company values" description="What we believe, in our own words." />
          <div className="p-5">
            {values.length === 0 ? (
              <EmptyState
                title="No values yet"
                description="Write down what matters here, so every new hire reads the same thing."
              />
            ) : (
              <ul className="flex flex-col gap-4">
                {values.map((value) => (
                  <li key={value.id} className="border-l-2 border-violet-600 pl-4">
                    <h3 className="font-display text-ink text-base font-bold">{value.title}</h3>
                    <p className="text-muted mt-1 text-sm">{value.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Operating standards"
            description="What happens every shift, regardless of who is working."
          />
          <div className="p-5">
            {standards.length === 0 ? (
              <EmptyState
                title="No standards yet"
                description="Standards are what daily checklists will be measured against."
              />
            ) : (
              <ul className="flex flex-col gap-4">
                {standards.map((standard) => (
                  <li key={standard.id} className="border-l-2 border-pink-500 pl-4">
                    <h3 className="font-display text-ink text-base font-bold">{standard.title}</h3>
                    <p className="text-muted mt-1 text-sm">{standard.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      {mayEdit ? (
        <div className="mt-5">
          <Card>
            <CardHeader title="Add a value or standard" />
            <div className="p-5">
              <ValueForm />
            </div>
          </Card>
        </div>
      ) : null}
    </>
  )
}
