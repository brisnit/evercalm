import type { Metadata } from 'next'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { getEmployment } from '@/modules/people/service'
import { Badge, Card, CardHeader, TextLink } from '@/ui/primitives'
import { EmployeeShell } from '../_components/employee-shell'
import { ProfileForm } from './profile-form'

export const metadata: Metadata = { title: 'Your profile' }
export const dynamic = 'force-dynamic'

/**
 * The employee's own profile.
 *
 * Round 2 asked for "a tab for profile, where the employee can edit their
 * details easily". What they may change is what is genuinely theirs: how to
 * reach them, and who to call if something happens at work. Their job title,
 * roles, locations and employment status belong to their employer and are
 * shown here as facts, not fields - that boundary is the point.
 */
export default async function MyProfilePage() {
  const { actor, activeOrganization } = await requireActorContext()
  const me = await withTenant(actor.organizationId, (tx) =>
    getEmployment(tx, actor, actor.employmentId),
  )

  return (
    <EmployeeShell>
      <h1 className="font-display text-ink text-[1.75rem] leading-tight font-extrabold tracking-tight">
        Your profile
      </h1>
      <p className="text-muted mt-1 text-sm">{activeOrganization.organizationName}</p>

      <div className="mt-6 flex flex-col gap-4">
        <Card>
          <CardHeader
            title="How to reach you"
            description="Your manager sees this. Keep it current so the right person can call you."
          />
          <div className="p-5">
            <ProfileForm
              employmentId={actor.employmentId}
              contact={{
                phone: me.contact?.phone ?? null,
                dateOfBirth: me.contact?.dateOfBirth ?? null,
                emergencyContactName: me.contact?.emergencyContactName ?? null,
                emergencyContactPhone: me.contact?.emergencyContactPhone ?? null,
              }}
              email={me.contact?.email ?? null}
            />
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Your job"
            description="Set by your employer. Ask your manager if something here is wrong."
          />
          <dl className="divide-line divide-y">
            {(
              [
                ['Name', me.displayName],
                ['Job title', me.jobTitle ?? 'Not set'],
                ['Home location', me.homeLocationName ?? 'None'],
                ['Reports to', me.managerName ?? 'Nobody'],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-4 px-5 py-3">
                <dt className="text-muted text-sm">{label}</dt>
                <dd className="text-ink text-right text-sm font-medium">{value}</dd>
              </div>
            ))}
            <div className="flex items-center justify-between gap-4 px-5 py-3">
              <dt className="text-muted text-sm">Status</dt>
              <dd>
                <Badge tone={me.status === 'active' ? 'success' : 'neutral'}>
                  {me.status === 'active' ? 'Active' : me.status}
                </Badge>
              </dd>
            </div>
          </dl>
        </Card>

        <Card>
          <CardHeader title="Your account" />
          <div className="flex flex-col gap-2 p-5 text-sm">
            <p className="text-muted">
              Signed in as <span className="text-ink font-medium">{me.contact?.email ?? ''}</span>.
            </p>
            <TextLink href="/my/notifications" standalone>
              Notification settings
            </TextLink>
            <TextLink href="/my/availability" standalone>
              When you can work
            </TextLink>
          </div>
        </Card>
      </div>
    </EmployeeShell>
  )
}
