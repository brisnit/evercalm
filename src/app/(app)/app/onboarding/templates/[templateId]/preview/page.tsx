import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { formatCalendarDate } from '@/lib/dates'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { getTemplate } from '@/modules/onboarding/templates'
import { previewVersion } from '@/modules/onboarding/service'
import { canAtAnyLocation } from '@/server/authz/can'
import { ForbiddenError, NotFoundError } from '@/lib/errors'
import {
  BackLink,
  Badge,
  ButtonLink,
  Card,
  EmptyState,
  PageHeader,
  ProgressBar,
} from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'

export const metadata: Metadata = { title: 'Preview' }
export const dynamic = 'force-dynamic'

/**
 * The employee preview.
 *
 * Renders the checklist the way a new hire sees it, from the draft when one
 * exists and the published version otherwise. Built from the same data the
 * real run would copy, so what you see here is genuinely what they get - not a
 * mock-up that can drift.
 */
export default async function TemplatePreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ templateId: string }>
  searchParams: Promise<{ version?: string }>
}) {
  const { templateId } = await params
  const which = (await searchParams).version
  const { actor } = await requireActorContext()
  if (!canAtAnyLocation(actor, 'onboarding.manage')) {
    return <PermissionDenied capabilityLabel="Manage onboarding checklists" />
  }

  const data = await withTenant(actor.organizationId, async (tx) => {
    try {
      const template = await getTemplate(tx, actor, templateId)
      const chosen =
        which === 'published'
          ? (template.publishedVersion ?? template.draftVersion)
          : (template.draftVersion ?? template.publishedVersion)
      if (!chosen) return { template, version: null, sections: [] }
      return {
        template,
        version: chosen,
        sections: await previewVersion(tx, actor, chosen.id),
      }
    } catch (error) {
      if (error instanceof NotFoundError) return 'not_found' as const
      if (error instanceof ForbiddenError) return 'forbidden' as const
      throw error
    }
  })

  // Another organization's checklist is indistinguishable from none: a real 404.
  if (data === 'not_found') notFound()
  if (data === 'forbidden') {
    return <PermissionDenied capabilityLabel="Manage onboarding checklists" />
  }

  const { template, version, sections } = data
  const allSteps = sections.flatMap((s) => s.steps)
  const gating = allSteps.filter((s) => s.required && s.blocksCompletion)
  const waiting = allSteps.filter((s) => s.awaitingPlatform)

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3">
        <BackLink href={`/app/onboarding/templates/${templateId}`}>{template.name}</BackLink>
      </nav>

      <PageHeader
        eyebrow="Preview"
        title="What a new hire sees"
        description="Exactly what this checklist produces, built from the same data a real run copies."
        action={
          template.draftVersion && template.publishedVersion ? (
            <div className="flex gap-2">
              <ButtonLink
                href={`/app/onboarding/templates/${templateId}/preview?version=draft`}
                variant="secondary"
              >
                Draft v{template.draftVersion.versionNumber}
              </ButtonLink>
              <ButtonLink
                href={`/app/onboarding/templates/${templateId}/preview?version=published`}
                variant="secondary"
              >
                Published v{template.publishedVersion.versionNumber}
              </ButtonLink>
            </div>
          ) : undefined
        }
      />

      {!version ? (
        <EmptyState
          title="Nothing to preview yet"
          description="Add some steps to this checklist and they will appear here."
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          {/* The employee's phone, at roughly real width. */}
          <Card className="overflow-hidden">
            <div className="border-line bg-raise border-b px-5 py-3">
              <p className="text-muted text-xs font-semibold tracking-wide uppercase">
                Employee view · {version.status === 'draft' ? 'Draft' : 'Published'} v
                {version.versionNumber}
              </p>
            </div>

            <div className="p-5">
              <div className="border-line rounded-card mx-auto max-w-md border bg-white p-5">
                <p className="text-faint text-xs font-semibold tracking-[0.1em] uppercase">
                  Your onboarding
                </p>
                <h2 className="font-display text-ink mt-1 text-xl font-extrabold">
                  {allSteps[0]?.title ?? 'Nothing to do yet'}
                </h2>
                <div className="mt-4">
                  <ProgressBar value={0} label={`0 of ${gating.length} required steps done`} />
                </div>

                <div className="mt-6 flex flex-col gap-4">
                  {sections.map((section) => (
                    <section key={section.sectionTitle}>
                      <h3 className="text-muted mb-2 text-xs font-bold tracking-[0.06em] uppercase">
                        {section.sectionTitle}
                      </h3>
                      <ul className="flex flex-col gap-2">
                        {section.steps.map((step) => (
                          <li key={step.id} className="border-line rounded-control border p-3">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-ink text-sm font-medium">{step.title}</p>
                                <p className="text-muted mt-0.5 text-xs">
                                  {step.awaitingPlatform
                                    ? 'Waiting'
                                    : step.training
                                      ? `Course: ${step.training.courseTitle}`
                                      : !step.selfCompletable
                                        ? 'A manager confirms this one'
                                        : step.required
                                          ? 'Required'
                                          : 'Optional'}
                                  {step.dueOn ? ` · due ${formatCalendarDate(step.dueOn)}` : ''}
                                </p>
                              </div>
                              {step.awaitingPlatform ? (
                                <Badge tone="warning">Waiting</Badge>
                              ) : step.training ? (
                                <Badge tone="info">Training</Badge>
                              ) : step.selfCompletable ? (
                                <Badge tone="violet">To do</Badge>
                              ) : (
                                <Badge tone="neutral">Manager</Badge>
                              )}
                            </div>
                            {step.instructions ? (
                              <p className="text-muted mt-2 text-xs">{step.instructions}</p>
                            ) : null}
                            {step.blockedReason ? (
                              <p className="border-warning/30 bg-warning-soft text-ink rounded-control mt-2 border px-2.5 py-2 text-xs">
                                {step.blockedReason}
                              </p>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <div className="p-5">
              <h2 className="font-display text-ink text-base font-bold">What this produces</h2>
              <dl className="mt-4 flex flex-col gap-3 text-sm">
                {[
                  ['Sections', String(sections.length)],
                  ['Steps in total', String(allSteps.length)],
                  ['Required to finish', String(gating.length)],
                  [
                    'The employee can do alone',
                    String(allSteps.filter((s) => s.selfCompletable).length),
                  ],
                  [
                    'A manager must confirm',
                    String(
                      allSteps.filter(
                        (s) => !s.selfCompletable && !s.awaitingPlatform && !s.training,
                      ).length,
                    ),
                  ],
                  ['Completes with a course', String(allSteps.filter((s) => s.training).length)],
                  ['Waiting on EverCalm', String(waiting.length)],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3">
                    <dt className="text-muted">{label}</dt>
                    <dd className="text-ink font-medium tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>

              {waiting.length > 0 ? (
                <p className="text-muted border-line mt-4 border-t pt-4 text-xs">
                  {waiting.length} {waiting.length === 1 ? 'step depends' : 'steps depend'} on a
                  system that has not shipped. They appear as waiting rather than as something the
                  new hire failed to do, and they do not hold up their progress.
                </p>
              ) : null}
            </div>
          </Card>
        </div>
      )}
    </>
  )
}
