import { openThreadAction } from '@/modules/messaging/actions'
import { Button } from '@/ui/primitives'

/**
 * "Your manager scheduled you anyway."
 *
 * Round 2 is explicit that the person sees this, and that they can respond.
 * The reply button opens a real direct conversation with their manager — not
 * a dead end, and not a form that goes nowhere.
 */
export function OverrideNotice({
  override,
  managerEmploymentId,
  managerName,
}: {
  override: { kind: 'unavailable' | 'not_preferred'; reason: string }
  managerEmploymentId: string | null
  managerName: string | null
}) {
  return (
    <div className="rounded-card border-warning/30 bg-warning-soft border p-4">
      <p className="text-ink text-sm font-semibold">
        {override.kind === 'unavailable'
          ? 'You are marked unavailable for these hours.'
          : 'These are hours you said you would rather not work.'}
      </p>
      <p className="text-muted mt-1 text-sm">
        Your manager scheduled you anyway, and knows that you said so.
        {override.reason ? ` They noted: “${override.reason}”` : ''}
      </p>
      {managerEmploymentId ? (
        <form action={openThreadAction} className="mt-3">
          <input type="hidden" name="employmentId" value={managerEmploymentId} />
          <input type="hidden" name="from" value="my" />
          <Button type="submit" variant="secondary" size="sm">
            Reply to {managerName?.split(' ')[0] ?? 'your manager'}
          </Button>
        </form>
      ) : null}
    </div>
  )
}
