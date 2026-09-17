'use client'

import { createHandoffAction } from '@/modules/operations/actions'
import { HandoffTaskFields } from '@/ui/patterns/handoff-task-fields'
import { MiniForm } from '@/ui/patterns/mini-form'

/** A manager's handoff at a location: the task, and who it is for. */
export function ManagerHandoffForm({
  locationId,
  assignees,
}: {
  locationId: string
  assignees: { id: string; name: string }[]
}) {
  return (
    <MiniForm
      action={createHandoffAction}
      hidden={{ locationId, shiftId: '' }}
      submitLabel="Leave handoff"
      variant="primary"
    >
      {(state) => (
        <HandoffTaskFields prefix="handoff" assignees={assignees} errors={state.fieldErrors} />
      )}
    </MiniForm>
  )
}
