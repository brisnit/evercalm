import type { Metadata } from 'next'
import Link from 'next/link'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { canAtAnyLocation } from '@/server/authz/can'
import { locationsWhere } from '@/modules/scheduling/access'
import { listTemplateSets } from '@/modules/scheduling/slotted'
import { Badge, ButtonLink, Card, CardHeader, EmptyState, PageHeader } from '@/ui/primitives'
import { PermissionDenied } from '@/ui/patterns/permission-denied'
import { NoticeProvider } from '@/ui/patterns/notice-provider'
import { MiniForm } from '@/ui/patterns/mini-form'
import { archiveTemplateSetAction } from '@/modules/scheduling/slotted-actions'
import { LocationPicker } from '../_components/location-picker'

export const metadata: Metadata = { title: 'Schedule templates' }
export const dynamic = 'force-dynamic'

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/**
 * The template library.
 *
 * A template is a described week, not a saved schedule: which days are open,
 * what staffing each of them needs, and the break rules. Every schedule starts
 * from one, which is what makes building a week a matter of choosing people
 * rather than drawing a grid.
 */
export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ location?: string }>
}) {
  const params = await searchParams
  const { actor } = await requireActorContext()
  if (!canAtAnyLocation(actor, 'schedule.view_all')) {
    return <PermissionDenied capabilityLabel="View all schedules" />
  }

  const { locations, current, sets } = await withTenant(actor.organizationId, async (tx) => {
    const locations = await locationsWhere(tx, actor, 'schedule.view_all')
    const current =
      locations.find((l) => l.id === params.location) ??
      locations.find((l) => actor.locationIds.includes(l.id)) ??
      locations[0]
    return {
      locations,
      current,
      sets: current ? await listTemplateSets(tx, actor, current.id) : [],
    }
  })

  if (!current) {
    return (
      <>
        <PageHeader title="Templates" />
        <div className="py-7">
          <EmptyState
            title="No locations yet"
            description="Add a location in Settings before building a schedule template."
          />
        </div>
      </>
    )
  }

  const canManage = canAtAnyLocation(actor, 'schedule.manage_templates')

  return (
    <>
      <PageHeader
        eyebrow={current.name}
        title="Reusable"
        accent="weeks"
        description="Every schedule starts from one of these. Describe the week once; after that you only pick people."
        action={
          canManage ? (
            <ButtonLink href={`/app/schedule/templates/new?location=${current.id}`} size="lg">
              Create new template
            </ButtonLink>
          ) : undefined
        }
      />

      <div className="py-7">
        {locations.length > 1 ? (
          <div className="mb-5">
            <LocationPicker
              locations={locations}
              current={current.id}
              basePath="/app/schedule/templates"
            />
          </div>
        ) : null}

        {sets.length === 0 ? (
          <EmptyState
            title="No templates yet"
            description={
              canManage
                ? 'Guided setup takes about five minutes, and every week after that starts from it.'
                : 'A manager sets these up.'
            }
            action={
              canManage ? (
                <ButtonLink href={`/app/schedule/templates/new?location=${current.id}`}>
                  Create new template
                </ButtonLink>
              ) : undefined
            }
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {sets.map((set) => (
              <Card key={set.id} className="flex h-full flex-col">
                <CardHeader
                  title={set.name}
                  description={`${set.patterns} ${set.patterns === 1 ? 'shift pattern' : 'shift patterns'} · ${set.slotsPerWeek} slots · ${Math.round(set.weeklyMinutes / 60)} staff hours a week`}
                  action={set.isDefault ? <Badge tone="success">Default</Badge> : undefined}
                />
                <div className="flex flex-1 flex-col justify-between gap-4 p-5">
                  <div>
                    <p className="text-muted mb-2 text-xs font-semibold tracking-wide uppercase">
                      Open days
                    </p>
                    <ul className="flex gap-1.5">
                      {[1, 2, 3, 4, 5, 6, 7].map((day, index) => {
                        const open = set.openDays.includes(day)
                        return (
                          <li
                            key={day}
                            className={
                              open
                                ? 'bg-tile text-ink flex size-8 items-center justify-center rounded-full text-sm font-semibold'
                                : 'border-line text-faint flex size-8 items-center justify-center rounded-full border border-dashed text-sm'
                            }
                          >
                            <span aria-hidden="true">{DAY_LETTERS[index]}</span>
                            <span className="sr-only">{open ? 'Open' : 'Closed'}</span>
                          </li>
                        )
                      })}
                    </ul>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/app/schedule?location=${current.id}&template=${set.id}`}
                      className="text-action text-sm font-semibold underline-offset-4 hover:underline"
                    >
                      Start a week from this
                    </Link>
                    {canManage ? (
                      <NoticeProvider>
                        <MiniForm
                          action={archiveTemplateSetAction}
                          hidden={{ templateSetId: set.id }}
                          submitLabel="Archive"
                          variant="ghost"
                          size="sm"
                          className="ms-auto"
                        />
                      </NoticeProvider>
                    ) : null}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
