import type { Metadata } from 'next'
import Link from 'next/link'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { getOrganization, listLocations } from '@/modules/org/service'
import {
  listDepartments,
  listJobRoles,
  listStations,
  listValues,
} from '@/modules/structure/service'
import { listTemplates } from '@/modules/onboarding/templates'
import { listEmployments } from '@/modules/people/service'
import { can } from '@/server/authz/can'
import { ForbiddenError } from '@/lib/errors'
import { Badge, Card, PageHeader, ProgressBar } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'

export const metadata: Metadata = { title: 'Company setup' }
export const dynamic = 'force-dynamic'

/**
 * Company setup.
 *
 * A progress checklist rather than a modal wizard, because setup in a real
 * business happens over days and by more than one person. Every step reports
 * its ACTUAL state from the database, so it cannot claim progress that is not
 * there, and each links to the screen where the work is done.
 */
export default async function SetupPage() {
  const { actor } = await requireActorContext()
  if (!can(actor, 'org.view'))
    return <PermissionDenied capabilityLabel="View organization settings" />

  const data = await withTenant(actor.organizationId, async (tx) => {
    try {
      return {
        organization: await getOrganization(tx, actor),
        locations: await listLocations(tx, actor),
        departments: await listDepartments(tx, actor),
        jobRoles: await listJobRoles(tx, actor),
        stations: await listStations(tx, actor),
        values: await listValues(tx, actor),
        templates: await listTemplates(tx, actor),
        people: await listEmployments(tx, actor).catch(() => []),
      }
    } catch (error) {
      if (error instanceof ForbiddenError) return null
      throw error
    }
  })

  if (!data) return <PermissionDenied capabilityLabel="View organization settings" />

  const steps = [
    {
      title: 'Name your workspace and choose an industry',
      done: Boolean(data.organization.name && data.organization.industry),
      detail: `${data.organization.name} · ${data.organization.industry.replace(/_/g, ' ')}`,
      href: '/app/settings',
      cta: 'Review organization',
    },
    {
      title: 'Add your locations',
      done: data.locations.length > 0,
      detail:
        data.locations.length > 0
          ? data.locations.map((l) => l.name).join(', ')
          : 'Every schedule, checklist, and business date belongs to a location.',
      href: '/app/settings',
      cta: 'Manage locations',
    },
    {
      title: 'Set up departments and job roles',
      done: data.jobRoles.length > 0,
      detail:
        data.jobRoles.length > 0
          ? `${data.departments.length} departments, ${data.jobRoles.length} job roles`
          : 'The roles people actually work, in your own words.',
      href: '/app/settings/structure',
      cta: 'Manage structure',
    },
    {
      title: 'Define your work positions',
      done: data.stations.length > 0,
      detail:
        data.stations.length > 0
          ? `${data.stations.length} positions across ${data.locations.length} locations`
          : 'A bar and a host stand, or chairs and treatment rooms.',
      href: '/app/settings/structure',
      cta: 'Add positions',
    },
    {
      title: 'Write your values and operating standards',
      done: data.values.length > 0,
      detail:
        data.values.length > 0
          ? `${data.values.filter((v) => v.kind === 'value').length} values, ${data.values.filter((v) => v.kind === 'standard').length} standards`
          : 'New hires read these during onboarding.',
      href: '/app/settings/values',
      cta: 'Write them',
    },
    {
      title: 'Build an onboarding checklist',
      done: data.templates.some((t) => t.status === 'published'),
      detail: data.templates.some((t) => t.status === 'published')
        ? `${data.templates.filter((t) => t.status === 'published').length} published, ready to assign`
        : 'What every new hire completes in their first weeks.',
      href: '/app/onboarding/templates',
      cta: 'Build one',
    },
    {
      title: 'Invite your team',
      done: data.people.length > 1,
      detail:
        data.people.length > 1
          ? `${data.people.length} people in the directory`
          : 'Send single-use invitations. Nothing is granted until they accept.',
      href: '/app/people/invite',
      cta: 'Invite someone',
    },
  ]

  const doneCount = steps.filter((s) => s.done).length
  const percent = Math.round((doneCount / steps.length) * 100)

  return (
    <>
      <PageHeader
        eyebrow="Getting started"
        title="Company setup"
        description="Work through these in any order. Progress reflects what is actually in your workspace."
      />

      <Card className="mb-6 p-5">
        <ProgressBar
          value={percent}
          label={`${doneCount} of ${steps.length} steps complete`}
          tone={percent === 100 ? 'success' : 'violet'}
        />
        {percent === 100 ? (
          <p className="text-success mt-3 text-sm">
            Setup is complete. Scheduling, training, and daily operations arrive in later releases.
          </p>
        ) : null}
      </Card>

      <ol className="flex flex-col gap-3">
        {steps.map((step, index) => (
          <li key={step.title}>
            <Card className="flex flex-wrap items-start gap-4 p-5">
              <span
                className={
                  step.done
                    ? 'bg-success mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white'
                    : 'border-line-strong text-muted mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full border bg-white text-sm font-bold tabular-nums'
                }
              >
                <span className="sr-only">{step.done ? 'Complete:' : `Step ${index + 1}:`}</span>
                <span aria-hidden="true">{step.done ? '✓' : index + 1}</span>
              </span>

              <div className="min-w-0 flex-1">
                <h2 className="font-display text-ink text-base font-bold">{step.title}</h2>
                <p className="text-muted mt-1 text-sm">{step.detail}</p>
              </div>

              <div className="flex items-center gap-3">
                {step.done ? <Badge tone="success">Done</Badge> : null}
                <Link
                  href={step.href}
                  className="rounded-control border-line-strong text-ink hover:bg-sunk inline-flex min-h-11 items-center border px-4 text-sm font-medium"
                >
                  {step.cta}
                </Link>
              </div>
            </Card>
          </li>
        ))}
      </ol>
    </>
  )
}
