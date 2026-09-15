'use client'

import { useMemo, useState } from 'react'
import { createAnnouncementAction, updateDraftAction } from '@/modules/comms/actions'
import { ActionForm } from '@/ui/patterns/action-form'
import { Disclosure, Field, Input } from '@/ui/primitives'
import type { AudienceOption, AudienceOptionGroups } from './audience-options'

/**
 * The announcement composer.
 *
 * The audience builder is the part worth explaining. Rules are chosen as
 * chips, and the summary underneath is written as a sentence that states the
 * combination rules rather than assuming the author knows them:
 *
 *   "Everyone at Riverside and the Bar team, except the Kitchen department"
 *
 * The exact count comes from the server on the announcement page, because only
 * the server can resolve who is actually in a group. The composer shows the
 * shape of the audience; it never guesses at a number.
 */

interface Category {
  id: string
  key: string
  name: string
  description: string
  overridesPreferences: boolean
}

export interface DraftRule {
  mode: 'include' | 'exclude'
  selectorType: string
  selectorId: string | null
  label: string
}

const PRIORITIES = [
  { value: 'normal', label: 'Normal', hint: 'Appears in date order.' },
  { value: 'important', label: 'Important', hint: 'Labelled, and lifted above normal.' },
  {
    value: 'urgent',
    label: 'Urgent',
    hint: 'Pinned to the top. In a safety or HR category it also reaches people during quiet hours.',
  },
  {
    value: 'emergency',
    label: 'Emergency',
    hint: 'Pinned, and reaches everyone immediately, whatever they have switched off or set as quiet hours.',
  },
] as const

export function Composer({
  mode,
  categories,
  options,
  events,
  permissions,
  initial,
  timeZone,
}: {
  mode: 'create' | 'edit'
  categories: Category[]
  options: AudienceOptionGroups
  events: { id: string; title: string; startsAt: string }[]
  permissions: { organizationWide: boolean; mayUseUrgent: boolean; mayUseEmergency: boolean }
  /** Dates and times typed here are read in this zone. */
  timeZone: string
  initial?: {
    announcementId: string
    title: string
    body: string
    categoryId: string
    priority: string
    requiresAcknowledgement: boolean
    acknowledgementDueAt: string
    expiresAt: string
    callToActionLabel: string
    callToActionHref: string
    eventId: string
    rules: DraftRule[]
  }
}) {
  const [rules, setRules] = useState<DraftRule[]>(initial?.rules ?? [])
  const [requiresAck, setRequiresAck] = useState(initial?.requiresAcknowledgement ?? false)
  const [priority, setPriority] = useState(initial?.priority ?? 'normal')
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? categories[0]?.id ?? '')

  const summary = useMemo(() => describe(rules), [rules])
  const category = categories.find((c) => c.id === categoryId)

  function addRule(option: AudienceOption, ruleMode: 'include' | 'exclude') {
    setRules((current) => {
      const exists = current.some(
        (r) => r.mode === ruleMode && r.selectorType === option.type && r.selectorId === option.id,
      )
      if (exists) return current
      return [
        ...current,
        {
          mode: ruleMode,
          selectorType: option.type,
          selectorId: option.id,
          label: option.label,
        },
      ]
    })
  }

  function removeRule(index: number) {
    setRules((current) => current.filter((_, i) => i !== index))
  }

  const availablePriorities = PRIORITIES.filter(
    (p) =>
      (p.value !== 'urgent' || permissions.mayUseUrgent) &&
      (p.value !== 'emergency' || permissions.mayUseEmergency),
  )

  return (
    <ActionForm
      action={mode === 'create' ? createAnnouncementAction : updateDraftAction}
      submitLabel={mode === 'create' ? 'Save as draft' : 'Save changes'}
      stickySubmit={{
        hint:
          rules.length === 0
            ? 'Nothing is sent when you save. Add who sees it, then check the audience before publishing.'
            : 'Nothing is sent when you save. You check the audience before it is published.',
      }}
    >
      {(state) => (
        <>
          {initial ? (
            <input type="hidden" name="announcementId" value={initial.announcementId} />
          ) : null}
          <input type="hidden" name="audience" value={JSON.stringify(rules)} />

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start [&>*]:min-w-0">
            {/* --- the message ------------------------------------------ */}
            <div className="border-line/70 rounded-card flex flex-col gap-4 border bg-white p-5">
              <h2 className="font-display text-ink text-base font-bold">The message</h2>

              <Field id="title" label="Title" required error={state.fieldErrors?.title?.[0]}>
                {(p) => (
                  <Input
                    {...p}
                    name="title"
                    required
                    maxLength={160}
                    defaultValue={initial?.title}
                    placeholder="e.g. Allergen handling — read and confirm"
                  />
                )}
              </Field>

              <Field
                id="body"
                label="Message"
                required
                hint="Blank line for a new paragraph. Start a line with - for a bullet, or 1. for a numbered step. **bold** works."
                error={state.fieldErrors?.body?.[0]}
              >
                {(p) => (
                  <textarea
                    {...p}
                    name="body"
                    required
                    rows={12}
                    maxLength={8000}
                    defaultValue={initial?.body}
                    className="rounded-control border-field text-ink w-full border bg-white px-3 py-2.5 text-sm"
                    placeholder={'What people need to know.\n\n- One thing\n- Another thing'}
                  />
                )}
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="callToActionLabel" label="Button label" hint="Optional.">
                  {(p) => (
                    <Input
                      {...p}
                      name="callToActionLabel"
                      defaultValue={initial?.callToActionLabel}
                      placeholder="e.g. Open the matrix"
                    />
                  )}
                </Field>
                <Field
                  id="callToActionHref"
                  label="Button link"
                  hint="An EverCalm path, or an http(s) address."
                  error={state.fieldErrors?.callToActionHref?.[0]}
                >
                  {(p) => (
                    <Input
                      {...p}
                      name="callToActionHref"
                      defaultValue={initial?.callToActionHref}
                      placeholder="/app/settings/values"
                    />
                  )}
                </Field>
              </div>
            </div>

            {/* --- settings ---------------------------------------------- */}
            <div className="flex flex-col gap-5">
              <div className="border-line/70 rounded-card flex flex-col gap-4 border bg-white p-5">
                <h2 className="font-display text-ink text-base font-bold">How it behaves</h2>

                <Field id="categoryId" label="Category" required>
                  {(p) => (
                    <select
                      {...p}
                      name="categoryId"
                      value={categoryId}
                      onChange={(e) => setCategoryId(e.target.value)}
                      className="rounded-control border-line-strong text-ink min-h-11 w-full border bg-white px-3 text-sm"
                    >
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                {category ? (
                  <p className="text-muted -mt-2 text-xs">
                    {category.description}
                    {category.overridesPreferences
                      ? ' This category cannot be switched off. It still waits for quiet hours to end, unless you mark it urgent.'
                      : ''}
                  </p>
                ) : null}

                <fieldset className="border-0 p-0">
                  <legend className="text-ink text-sm font-medium">Priority</legend>
                  <div className="mt-2 flex flex-col gap-2">
                    {availablePriorities.map((option) => (
                      <label key={option.value} className="flex items-start gap-2.5 text-sm">
                        <input
                          type="radio"
                          name="priority"
                          value={option.value}
                          checked={priority === option.value}
                          onChange={() => setPriority(option.value)}
                          className="mt-0.5 h-4 w-4"
                        />
                        <span>
                          <span className="text-ink font-medium">{option.label}</span>
                          <span className="text-muted block text-xs">{option.hint}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  {!permissions.mayUseEmergency ? (
                    <p className="text-faint mt-2 text-xs">
                      Emergency needs a separate permission.
                    </p>
                  ) : null}
                </fieldset>

                <label className="flex items-start gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    name="requiresAcknowledgement"
                    checked={requiresAck}
                    onChange={(e) => setRequiresAck(e.target.checked)}
                    className="mt-0.5 h-4 w-4"
                  />
                  <span>
                    <span className="text-ink font-medium">Ask people to confirm they read it</span>
                    <span className="text-muted block text-xs">
                      Opening it is recorded separately and never counts as confirmation.
                    </span>
                  </span>
                </label>

                {requiresAck ? (
                  <Field
                    id="acknowledgementDueAt"
                    label="Confirm by"
                    hint={`Optional, in ${timeZone} time. Overdue confirmations are flagged and reminded.`}
                  >
                    {(p) => (
                      <Input
                        {...p}
                        type="datetime-local"
                        name="acknowledgementDueAt"
                        defaultValue={initial?.acknowledgementDueAt}
                      />
                    )}
                  </Field>
                ) : null}

                <Field
                  id="expiresAt"
                  label="Expires"
                  hint={`Optional, in ${timeZone} time. It leaves the active inbox afterwards.`}
                  error={state.fieldErrors?.expiresAt?.[0]}
                >
                  {(p) => (
                    <Input
                      {...p}
                      type="datetime-local"
                      name="expiresAt"
                      defaultValue={initial?.expiresAt}
                    />
                  )}
                </Field>

                {events.length > 0 ? (
                  <Field id="eventId" label="Related event" hint="Optional.">
                    {(p) => (
                      <select
                        {...p}
                        name="eventId"
                        defaultValue={initial?.eventId ?? ''}
                        className="rounded-control border-field text-ink min-h-11 w-full border bg-white px-3 text-sm"
                      >
                        <option value="">No event</option>
                        {events.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.title} · {e.startsAt}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                ) : null}
              </div>

              {/* --- audience ------------------------------------------- */}
              <div className="border-line/70 rounded-card flex flex-col gap-4 border bg-white p-5">
                <div>
                  <h2 className="font-display text-ink text-base font-bold">Who sees it</h2>
                  <p className="text-muted mt-1 text-xs">
                    Groups add together. Anything you exclude is removed, even if another group
                    included it.
                  </p>
                </div>

                <div
                  className="rounded-control border-line bg-raise border px-3.5 py-3"
                  aria-live="polite"
                >
                  <p className="text-faint text-[0.6875rem] font-semibold tracking-wide uppercase">
                    Audience
                  </p>
                  <p className="text-ink mt-1 text-sm font-medium">{summary}</p>
                  {state.fieldErrors?.audience?.[0] ? (
                    <p className="text-danger mt-1.5 text-xs font-medium">
                      {state.fieldErrors.audience[0]}
                    </p>
                  ) : null}
                </div>

                {rules.length > 0 ? (
                  <ul className="flex flex-wrap gap-2">
                    {rules.map((rule, index) => (
                      <li key={`${rule.mode}-${rule.selectorType}-${rule.selectorId ?? 'org'}`}>
                        <span
                          className={
                            rule.mode === 'include'
                              ? 'inline-flex items-center gap-1.5 rounded-full bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700'
                              : 'bg-danger-soft text-danger inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium'
                          }
                        >
                          {rule.mode === 'exclude' ? 'Except ' : ''}
                          {rule.label}
                          <button
                            type="button"
                            onClick={() => removeRule(index)}
                            className="hover:text-ink"
                            aria-label={`Remove ${rule.label}`}
                          >
                            ×
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                <AudiencePicker options={options} onAdd={addRule} />
              </div>
            </div>
          </div>
        </>
      )}
    </ActionForm>
  )
}

function AudiencePicker({
  options,
  onAdd,
}: {
  options: AudienceOptionGroups
  onAdd: (option: AudienceOption, mode: 'include' | 'exclude') => void
}) {
  const [mode, setMode] = useState<'include' | 'exclude'>('include')

  const groups: { label: string; items: AudienceOption[] }[] = [
    { label: 'Everyone', items: options.organization },
    { label: 'Locations', items: options.locations },
    { label: 'Departments', items: options.departments },
    { label: 'Job roles', items: options.jobRoles },
    { label: 'Teams', items: options.teams },
    { label: 'Work positions', items: options.stations },
    { label: 'Individual people', items: options.people },
  ].filter((g) => g.items.length > 0)

  return (
    <div>
      <div className="flex gap-2" role="group" aria-label="Add or exclude">
        <button
          type="button"
          onClick={() => setMode('include')}
          aria-pressed={mode === 'include'}
          className={
            mode === 'include'
              ? 'rounded-control min-h-9 bg-violet-600 px-3 text-xs font-semibold text-white'
              : 'rounded-control border-line text-ink min-h-9 border bg-white px-3 text-xs font-medium'
          }
        >
          Add a group
        </button>
        <button
          type="button"
          onClick={() => setMode('exclude')}
          aria-pressed={mode === 'exclude'}
          className={
            mode === 'exclude'
              ? 'rounded-control bg-danger min-h-9 px-3 text-xs font-semibold text-white'
              : 'rounded-control border-line text-ink min-h-9 border bg-white px-3 text-xs font-medium'
          }
        >
          Exclude a group
        </button>
      </div>

      <div className="mt-3 flex flex-col gap-3">
        {groups.map((group) => (
          <Disclosure key={group.label} label={group.label} count={group.items.length}>
            <ul className="flex flex-wrap gap-2">
              {group.items.map((option) => (
                <li key={`${option.type}-${option.id ?? 'org'}`}>
                  <button
                    type="button"
                    onClick={() => onAdd(option, mode)}
                    className="border-line text-ink rounded-full border bg-white px-3 py-1.5 text-xs font-medium hover:border-violet-400 hover:text-violet-700"
                  >
                    {option.label}
                    {option.hint ? <span className="text-faint"> · {option.hint}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </Disclosure>
        ))}
      </div>
    </div>
  )
}

/** The audience sentence, built the same way the server describes it. */
function describe(rules: DraftRule[]): string {
  const includes = rules.filter((r) => r.mode === 'include').map((r) => r.label)
  const excludes = rules.filter((r) => r.mode === 'exclude').map((r) => r.label)

  if (includes.length === 0) return 'Nobody yet — add at least one group.'
  const base = join(includes)
  return excludes.length === 0 ? base : `${base}, except ${join(excludes)}`
}

function join(items: string[]): string {
  if (items.length === 1) return items[0] ?? ''
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}
