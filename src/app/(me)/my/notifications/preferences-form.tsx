'use client'

import { useState } from 'react'
import { savePreferencesAction } from '@/modules/notifications/actions'
import { ActionForm } from '@/ui/patterns/action-form'
import { Field, Input } from '@/ui/primitives'

/**
 * The preferences form.
 *
 * One row per category, with a switch for each channel that can actually be
 * delivered. Channels that do not exist yet are not shown at all.
 */

interface CategoryView {
  key: string
  name: string
  description: string
  locked: boolean
}

const LIVE_CHANNELS = [
  { key: 'in_app', label: 'In app' },
  { key: 'email', label: 'Email' },
] as const

function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
}

export function PreferencesForm({
  categories,
  preferences,
  settings,
}: {
  categories: CategoryView[]
  preferences: Record<string, boolean>
  settings: {
    quietHoursEnabled: boolean
    quietStart: number
    quietEnd: number
    timezone: string | null
    effectiveTimezone: string
  }
}) {
  const [quietEnabled, setQuietEnabled] = useState(settings.quietHoursEnabled)

  // Every switch the form offers, so the action knows which unchecked boxes
  // mean "off" rather than "not shown".
  const offered = categories
    .filter((c) => !c.locked)
    .flatMap((c) => LIVE_CHANNELS.map((ch) => `${c.key}:${ch.key}`))
    .join(',')

  return (
    <ActionForm action={savePreferencesAction} submitLabel="Save preferences">
      <input type="hidden" name="offered" value={offered} />

      <fieldset className="border-0 p-0">
        <legend className="font-display text-ink text-sm font-bold">Categories</legend>
        <ul className="mt-3 flex flex-col gap-3">
          {categories.map((category) => (
            <li key={category.key} className="border-line/70 rounded-card border p-3.5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-ink text-sm font-semibold">{category.name}</p>
                  <p className="text-muted mt-0.5 text-xs">{category.description}</p>
                </div>
                {category.locked ? (
                  <span className="bg-sunk text-muted shrink-0 rounded-full px-2.5 py-1 text-[0.6875rem] font-semibold">
                    Cannot be switched off
                  </span>
                ) : null}
              </div>

              {category.locked ? (
                <p className="text-muted mt-2.5 text-xs">
                  There is nothing to switch off here. These still wait for your quiet hours to end,
                  unless they are marked urgent or are an emergency.
                </p>
              ) : (
                <div className="mt-1 flex flex-wrap gap-x-6">
                  {LIVE_CHANNELS.map((channel) => {
                    const id = `pref:${category.key}:${channel.key}`
                    const enabled = preferences[`${category.key}:${channel.key}`] ?? true
                    return (
                      <label
                        key={channel.key}
                        className="flex min-h-11 items-center gap-2.5 text-sm"
                      >
                        <input
                          type="checkbox"
                          id={id}
                          name={id}
                          defaultChecked={enabled}
                          className="size-5"
                        />
                        {channel.label}
                      </label>
                    )
                  })}
                </div>
              )}
            </li>
          ))}
        </ul>
      </fieldset>

      <fieldset className="border-line/70 rounded-card mt-2 border-0 p-0">
        <legend className="font-display text-ink text-sm font-bold">Quiet hours</legend>
        <p className="text-muted mt-1 text-xs">
          Messages that arrive during quiet hours are held and delivered afterwards. They are never
          dropped. Only an emergency, or an urgent safety or HR notice, comes through during quiet
          hours. A request to confirm you have read something waits until they end, like anything
          else.
        </p>

        <label className="mt-3 flex min-h-11 items-center gap-2.5 text-sm">
          <input
            type="checkbox"
            name="quietHoursEnabled"
            defaultChecked={settings.quietHoursEnabled}
            onChange={(e) => setQuietEnabled(e.target.checked)}
            className="size-5"
          />
          Hold notifications during quiet hours
        </label>

        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <Field id="quietStart" label="From" hint="Your local time.">
            {(p) => (
              <Input
                {...p}
                type="time"
                name="quietStart"
                defaultValue={minutesToTime(settings.quietStart)}
                disabled={!quietEnabled}
              />
            )}
          </Field>
          <Field id="quietEnd" label="Until" hint="Overnight windows are fine.">
            {(p) => (
              <Input
                {...p}
                type="time"
                name="quietEnd"
                defaultValue={minutesToTime(settings.quietEnd)}
                disabled={!quietEnabled}
              />
            )}
          </Field>
        </div>

        <div className="mt-3">
          <Field
            id="timezone"
            label="Timezone"
            hint={`Leave blank to follow your location (${settings.effectiveTimezone}).`}
          >
            {(p) => (
              <Input
                {...p}
                name="timezone"
                defaultValue={settings.timezone ?? ''}
                placeholder={settings.effectiveTimezone}
              />
            )}
          </Field>
        </div>
      </fieldset>
    </ActionForm>
  )
}
