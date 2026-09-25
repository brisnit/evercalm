import { generateWeekAction } from '@/modules/scheduling/slotted-actions'
import { Button, ButtonLink, Card, CardHeader, EmptyState } from '@/ui/primitives'

/**
 * The first move of a new week: pick a template, and the slots appear.
 *
 * A plain server-action form, because generating a week is one decision and
 * should not need JavaScript to make it.
 */
export function StartWeek({
  locationId,
  weekStart,
  sets,
  preselect,
}: {
  locationId: string
  weekStart: string
  sets: { id: string; name: string; slotsPerWeek: number; isDefault: boolean }[]
  preselect?: string
}) {
  if (sets.length === 0) {
    return (
      <EmptyState
        title="No template for this location yet"
        description="A template describes the week once — open days, the shifts each of them needs, and the break rules. After that, building a week is only choosing people."
        action={
          <ButtonLink href={`/app/schedule/templates/new?location=${locationId}`}>
            Create a template
          </ButtonLink>
        }
      />
    )
  }

  const chosen = sets.find((s) => s.id === preselect) ?? sets.find((s) => s.isDefault) ?? sets[0]!

  return (
    <Card>
      <CardHeader
        title="Start the week"
        description="The template lays out every slot. Nobody is assigned yet — that is the next step, and autofill can do most of it."
      />
      <div className="p-5">
        <ul className="mb-5 flex flex-col gap-2">
          {sets.map((set) => (
            <li key={set.id}>
              <form action={generateWeekAction}>
                <input type="hidden" name="locationId" value={locationId} />
                <input type="hidden" name="weekStart" value={weekStart} />
                <input type="hidden" name="templateSetId" value={set.id} />
                <div className="rounded-control border-line flex flex-wrap items-center gap-3 border bg-white px-4 py-3">
                  <span className="text-ink font-medium">{set.name}</span>
                  <span className="text-muted text-sm">{set.slotsPerWeek} slots a week</span>
                  <Button
                    type="submit"
                    size="sm"
                    variant={set.id === chosen.id ? 'primary' : 'secondary'}
                    className="ms-auto"
                  >
                    Generate this week
                  </Button>
                </div>
              </form>
            </li>
          ))}
        </ul>
        <p className="text-muted text-sm">
          Running it again adds nothing twice — it tops each day up to the staffing the template
          asks for.
        </p>
      </div>
    </Card>
  )
}
