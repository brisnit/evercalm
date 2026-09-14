'use client'

import { applyTemplatesAction } from '@/modules/scheduling/actions'
import { ActionForm } from '@/ui/patterns/action-form'

export function ApplyTemplatesForm({
  locationId,
  weekStart,
  templates,
}: {
  locationId: string
  weekStart: string
  templates: { id: string; label: string }[]
}) {
  return (
    <ActionForm
      action={applyTemplatesAction}
      submitLabel="Add shifts from templates"
      variant="secondary"
    >
      <input type="hidden" name="locationId" value={locationId} />
      <input type="hidden" name="weekStart" value={weekStart} />
      <fieldset className="border-0 p-0">
        <legend className="text-ink text-sm font-medium">Templates</legend>
        <ul className="mt-2 flex flex-col gap-2">
          {templates.map((t) => (
            <li key={t.id}>
              <label className="flex items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  name="templateIds"
                  value={t.id}
                  defaultChecked
                  className="mt-0.5 h-4 w-4"
                />
                <span className="text-ink">{t.label}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
    </ActionForm>
  )
}
