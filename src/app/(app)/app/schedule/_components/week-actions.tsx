import { autofillWeekAction } from '@/modules/scheduling/slotted-actions'
import { Button, ButtonLink } from '@/ui/primitives'

/** Autofill, review, publish: the three moves left once the week exists. */
export function WeekActions({
  scheduleId,
  filled,
  slots,
  status,
}: {
  scheduleId: string
  filled: number
  slots: number
  status: string
}) {
  const empty = slots - filled
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {empty > 0 ? (
        <form action={autofillWeekAction}>
          <input type="hidden" name="scheduleId" value={scheduleId} />
          <Button type="submit" variant="secondary" size="lg">
            Autofill {empty} {empty === 1 ? 'slot' : 'slots'}
          </Button>
        </form>
      ) : null}
      <ButtonLink href={`/app/schedule/review/${scheduleId}`} variant="secondary" size="lg">
        Review the week
      </ButtonLink>
      <ButtonLink href={`/app/schedule/publish/${scheduleId}`} size="lg">
        {status === 'published' ? 'Publish changes' : 'Publish'}
      </ButtonLink>
    </div>
  )
}
