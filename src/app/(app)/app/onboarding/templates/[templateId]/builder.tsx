'use client'

import { useState } from 'react'
import {
  addSectionAction,
  addStepAction,
  archiveTemplateAction,
  createDraftAction,
  deleteSectionAction,
  deleteStepAction,
  duplicateTemplateAction,
  publishVersionAction,
  reorderAction,
  setTargetingAction,
  updateStepAction,
  updateTemplateAction,
} from '@/modules/onboarding/template-actions'
import {
  RESPONSIBILITY_LABELS,
  STEP_KIND_LABELS,
  type TemplateDetail,
} from '@/modules/onboarding/templates'
import { Badge, Button, Card, CardHeader, Field, Input, Select } from '@/ui/primitives'
import { ActionForm } from '@/ui/patterns/action-form'
import { ConfirmAction } from '@/ui/patterns/confirm-action'

/**
 * The checklist builder.
 *
 * Editing is only ever offered against a DRAFT version. When a template is
 * published with no draft, the content is read-only and the only edit path is
 * "Start a new draft" — which states in words that nothing live changes until
 * it is published.
 */

const STEP_KINDS = Object.entries(STEP_KIND_LABELS)
const RESPONSIBILITIES = Object.entries(RESPONSIBILITY_LABELS)

/** Kinds whose backing system has not shipped. */
const PLACEHOLDER_KINDS = new Set(['policy_ack'])

interface CourseOption {
  id: string
  title: string
  versionNumber: number
}

export function TemplateBuilder({
  template,
  impact,
  jobRoles,
  locations,
  courses,
}: {
  template: TemplateDetail
  impact: { activeRuns: number; completedRuns: number; targetedRoles: number }
  jobRoles: { id: string; name: string }[]
  locations: { id: string; name: string }[]
  courses: CourseOption[]
}) {
  const archived = template.archivedAt !== null
  const draft = template.draftVersion
  const published = template.publishedVersion
  const editable = draft !== null && !archived

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start">
      <div className="flex flex-col gap-5">
        {editable ? (
          <DraftEditor template={template} courses={courses} />
        ) : (
          <ReadOnlyContent template={template} archived={archived} />
        )}
      </div>

      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader title="Publishing" />
          <div className="flex flex-col gap-4 p-5">
            {draft && !archived ? (
              <>
                <div className="rounded-control border border-teal-200 bg-teal-50 px-4 py-3">
                  <p className="text-ink text-sm font-medium">
                    Draft v{draft.versionNumber} is not live
                  </p>
                  <p className="text-muted mt-1 text-sm">
                    {published
                      ? `Everyone onboarding right now is on v${published.versionNumber} and stays there. Publishing only affects people assigned from that point on.`
                      : 'Nobody can be assigned this checklist until you publish it.'}
                  </p>
                </div>
                <ActionForm
                  action={publishVersionAction}
                  submitLabel={`Publish v${draft.versionNumber}`}
                >
                  <input type="hidden" name="templateId" value={template.id} />
                  <input type="hidden" name="versionId" value={draft.id} />
                </ActionForm>
              </>
            ) : published && !archived ? (
              <>
                <p className="text-muted text-sm">
                  v{published.versionNumber} is published and in use by {impact.activeRuns}{' '}
                  {impact.activeRuns === 1 ? 'person' : 'people'}. Published versions cannot be
                  edited, so changes start as a new draft.
                </p>
                <ActionForm
                  action={createDraftAction}
                  submitLabel="Start a new draft"
                  variant="secondary"
                >
                  <input type="hidden" name="templateId" value={template.id} />
                </ActionForm>
              </>
            ) : (
              <p className="text-muted text-sm">
                This checklist is archived. Restore it to make changes.
              </p>
            )}
          </div>
        </Card>

        {!archived ? (
          <Card>
            <CardHeader
              title="Who it applies to"
              description="Leave both empty to use it as a fallback."
            />
            <div className="p-5">
              <ActionForm
                action={setTargetingAction}
                submitLabel="Save targeting"
                variant="secondary"
              >
                <input type="hidden" name="templateId" value={template.id} />
                <fieldset className="flex flex-col gap-2">
                  <legend className="text-ink mb-1 text-sm font-medium">Job roles</legend>
                  {jobRoles.length === 0 ? (
                    <p className="text-muted text-sm">No job roles set up yet.</p>
                  ) : (
                    jobRoles.map((role) => (
                      <label key={role.id} className="flex min-h-9 items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          name="jobRoleIds"
                          value={role.id}
                          defaultChecked={template.jobRoleIds.includes(role.id)}
                          className="size-4"
                        />
                        <span className="text-ink">{role.name}</span>
                      </label>
                    ))
                  )}
                </fieldset>

                <fieldset className="mt-3 flex flex-col gap-2">
                  <legend className="text-ink mb-1 text-sm font-medium">Locations</legend>
                  {locations.map((location) => (
                    <label key={location.id} className="flex min-h-9 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="locationIds"
                        value={location.id}
                        defaultChecked={template.locationIds.includes(location.id)}
                        className="size-4"
                      />
                      <span className="text-ink">{location.name}</span>
                    </label>
                  ))}
                </fieldset>
              </ActionForm>
            </div>
          </Card>
        ) : null}

        <Card>
          <CardHeader title="Details" />
          <div className="p-5">
            <ActionForm
              action={updateTemplateAction}
              submitLabel="Save details"
              variant="secondary"
            >
              {(state) => (
                <>
                  <input type="hidden" name="templateId" value={template.id} />
                  <Field id="tpl-name" label="Name" required error={state.fieldErrors?.name?.[0]}>
                    {(p) => (
                      <Input
                        {...p}
                        name="name"
                        defaultValue={template.name}
                        required
                        maxLength={120}
                      />
                    )}
                  </Field>
                  <Field id="tpl-description" label="Description">
                    {(p) => (
                      <Input
                        {...p}
                        name="description"
                        defaultValue={template.description}
                        maxLength={400}
                      />
                    )}
                  </Field>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="isDefault"
                      defaultChecked={template.isDefault}
                      className="mt-0.5 size-4"
                    />
                    <span>
                      <span className="text-ink font-medium">Use as the default checklist</span>
                      <span className="text-muted block text-xs">
                        Given to anyone whose job role and location do not match a more specific
                        checklist. Only one checklist can be the default.
                      </span>
                    </span>
                  </label>
                </>
              )}
            </ActionForm>
          </div>
        </Card>

        <Card>
          <CardHeader title="Manage" />
          <div className="flex flex-col gap-3 p-5">
            <ActionForm
              action={duplicateTemplateAction}
              submitLabel="Duplicate"
              variant="secondary"
            >
              <input type="hidden" name="templateId" value={template.id} />
              <p className="text-muted text-sm">
                Creates a copy as a new draft. The original is untouched.
              </p>
            </ActionForm>

            {archived ? (
              <ActionForm action={archiveTemplateAction} submitLabel="Restore" variant="secondary">
                <input type="hidden" name="templateId" value={template.id} />
                <input type="hidden" name="intent" value="restore" />
              </ActionForm>
            ) : (
              <ConfirmAction
                triggerLabel="Archive"
                title={`Archive "${template.name}"?`}
                description={
                  impact.activeRuns > 0
                    ? `${impact.activeRuns} ${impact.activeRuns === 1 ? 'person is' : 'people are'} onboarding on this checklist right now. They keep it and finish normally. Nobody new will be assigned it, and it stops being available for new hires${template.isDefault ? ' — including as the default, which will leave your organization without one' : ''}.`
                    : 'Nobody new will be assigned it. Completed history is kept. You can restore it at any time.'
                }
              >
                <ActionForm action={archiveTemplateAction} submitLabel="Archive it" destructive>
                  <input type="hidden" name="templateId" value={template.id} />
                  <input type="hidden" name="intent" value="archive" />
                </ActionForm>
              </ConfirmAction>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}

function ReadOnlyContent({ template, archived }: { template: TemplateDetail; archived: boolean }) {
  const version = template.publishedVersion ?? template.draftVersion
  if (!version) {
    return (
      <Card className="p-5">
        <p className="text-muted text-sm">This checklist has no content yet.</p>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader
        title={`Version ${version.versionNumber}`}
        description={
          archived
            ? 'Archived. Restore the checklist to make changes.'
            : 'Published and in use. Start a new draft to make changes.'
        }
      />
      <div className="flex flex-col gap-6 p-5">
        {version.sections.map((section) => (
          <section key={section.id}>
            <h3 className="font-display text-ink text-sm font-bold">{section.title}</h3>
            {section.description ? (
              <p className="text-muted mt-0.5 text-sm">{section.description}</p>
            ) : null}
            <ul className="mt-3 flex flex-col gap-2">
              {section.steps.map((step) => (
                <li
                  key={step.id}
                  className="border-line rounded-control flex flex-wrap items-start justify-between gap-2 border px-3.5 py-3"
                >
                  <span className="min-w-0">
                    <span className="text-ink block text-sm font-medium">{step.title}</span>
                    <span className="text-muted block text-xs">
                      {STEP_KIND_LABELS[step.kind as keyof typeof STEP_KIND_LABELS] ?? step.kind} ·{' '}
                      {RESPONSIBILITY_LABELS[
                        step.responsibility as keyof typeof RESPONSIBILITY_LABELS
                      ] ?? step.responsibility}
                      {step.dueOffsetDays !== null
                        ? ` · day ${step.dueOffsetDays} after ${step.dueOffsetBasis === 'hire_date' ? 'hire date' : 'start'}`
                        : ''}
                    </span>
                  </span>
                  {step.courseTitle ? (
                    <span className="text-muted block text-xs">Course: {step.courseTitle}</span>
                  ) : null}
                  <span className="flex flex-wrap gap-1.5">
                    {!step.required ? <Badge tone="neutral">Optional</Badge> : null}
                    {step.awaitingPlatform ? (
                      <Badge tone="warning">Waiting on EverCalm</Badge>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Card>
  )
}

function DraftEditor({ template, courses }: { template: TemplateDetail; courses: CourseOption[] }) {
  const draft = template.draftVersion!
  const [openStep, setOpenStep] = useState<string | null>(null)

  return (
    <Card>
      <CardHeader
        title={`Draft v${draft.versionNumber}`}
        description="Changes here affect nobody until you publish."
      />

      <div className="flex flex-col gap-8 p-5">
        {draft.sections.map((section, sectionIndex) => (
          <section key={section.id} aria-labelledby={`section-${section.id}`}>
            <div className="border-line flex flex-wrap items-center justify-between gap-2 border-b pb-2">
              <h3 id={`section-${section.id}`} className="font-display text-ink text-sm font-bold">
                {section.title}
              </h3>
              <div className="flex items-center gap-1">
                <ReorderButton
                  templateId={template.id}
                  kind="section"
                  id={section.id}
                  direction="up"
                  disabled={sectionIndex === 0}
                  label={`Move ${section.title} up`}
                />
                <ReorderButton
                  templateId={template.id}
                  kind="section"
                  id={section.id}
                  direction="down"
                  disabled={sectionIndex === draft.sections.length - 1}
                  label={`Move ${section.title} down`}
                />
                {draft.sections.length > 1 ? (
                  <form action={deleteSectionAction as unknown as (fd: FormData) => void}>
                    <input type="hidden" name="templateId" value={template.id} />
                    <input type="hidden" name="sectionId" value={section.id} />
                    <button
                      type="submit"
                      className="text-muted hover:text-danger inline-flex min-h-9 items-center px-2 text-xs underline underline-offset-4"
                    >
                      Remove section
                    </button>
                  </form>
                ) : null}
              </div>
            </div>

            <ul className="mt-3 flex flex-col gap-2">
              {section.steps.length === 0 ? (
                <li className="text-muted text-sm">No steps in this section yet.</li>
              ) : (
                section.steps.map((step, stepIndex) => (
                  <li key={step.id} className="border-line rounded-control border">
                    <div className="flex flex-wrap items-start justify-between gap-2 px-3.5 py-3">
                      <span className="min-w-0 flex-1">
                        <span className="text-ink block text-sm font-medium">{step.title}</span>
                        <span className="text-muted block text-xs">
                          {STEP_KIND_LABELS[step.kind as keyof typeof STEP_KIND_LABELS] ??
                            step.kind}{' '}
                          ·{' '}
                          {RESPONSIBILITY_LABELS[
                            step.responsibility as keyof typeof RESPONSIBILITY_LABELS
                          ] ?? step.responsibility}
                          {step.dueOffsetDays !== null
                            ? ` · day ${step.dueOffsetDays} after ${step.dueOffsetBasis === 'hire_date' ? 'hire date' : 'start'}`
                            : ' · no due date'}
                        </span>
                        {step.kind === 'training_assignment' ? (
                          <span className="text-muted mt-1 block text-xs">
                            {step.courseTitle
                              ? `Course: ${step.courseTitle}`
                              : 'No course linked yet'}
                          </span>
                        ) : null}
                        <span className="mt-1.5 flex flex-wrap gap-1.5">
                          {!step.required ? <Badge tone="neutral">Optional</Badge> : null}
                          {!step.blocksCompletion ? (
                            <Badge tone="neutral">Does not block completion</Badge>
                          ) : null}
                          {step.requiresManagerVerification ? (
                            <Badge tone="accent">Manager confirms</Badge>
                          ) : null}
                          {step.awaitingPlatform ? (
                            <Badge tone="warning">Waiting on EverCalm</Badge>
                          ) : null}
                          {step.kind === 'training_assignment' && !step.courseTitle ? (
                            <Badge tone="warning">Link a course</Badge>
                          ) : null}
                        </span>
                      </span>

                      <span className="flex items-center gap-1">
                        <ReorderButton
                          templateId={template.id}
                          kind="step"
                          id={step.id}
                          direction="up"
                          disabled={stepIndex === 0}
                          label={`Move ${step.title} up`}
                        />
                        <ReorderButton
                          templateId={template.id}
                          kind="step"
                          id={step.id}
                          direction="down"
                          disabled={stepIndex === section.steps.length - 1}
                          label={`Move ${step.title} down`}
                        />
                        <button
                          type="button"
                          onClick={() => setOpenStep(openStep === step.id ? null : step.id)}
                          aria-expanded={openStep === step.id}
                          className="text-muted hover:text-ink inline-flex min-h-9 items-center px-2 text-xs underline underline-offset-4"
                        >
                          {openStep === step.id ? 'Close' : 'Edit'}
                        </button>
                      </span>
                    </div>

                    {openStep === step.id ? (
                      <div className="border-line bg-raise border-t p-4">
                        <StepFields
                          templateId={template.id}
                          action={updateStepAction}
                          submitLabel="Save step"
                          hidden={{ stepId: step.id }}
                          defaults={step}
                          courses={courses}
                        />
                        <form
                          action={deleteStepAction as unknown as (fd: FormData) => void}
                          className="mt-3"
                        >
                          <input type="hidden" name="templateId" value={template.id} />
                          <input type="hidden" name="stepId" value={step.id} />
                          <button
                            type="submit"
                            className="text-muted hover:text-danger text-xs underline underline-offset-4"
                          >
                            Remove this step
                          </button>
                        </form>
                      </div>
                    ) : null}
                  </li>
                ))
              )}
            </ul>

            <details className="mt-3">
              <summary className="text-sm font-medium text-teal-700 underline-offset-4 hover:underline">
                Add a step to {section.title}
              </summary>
              <div className="border-line bg-raise rounded-card mt-3 border p-4">
                <StepFields
                  templateId={template.id}
                  action={addStepAction}
                  submitLabel="Add step"
                  hidden={{ sectionId: section.id }}
                  courses={courses}
                />
              </div>
            </details>
          </section>
        ))}

        <div className="border-line border-t pt-5">
          <ActionForm action={addSectionAction} submitLabel="Add section" variant="secondary">
            {(state) => (
              <>
                <input type="hidden" name="templateId" value={template.id} />
                <input type="hidden" name="versionId" value={draft.id} />
                <Field
                  id="new-section"
                  label="New section"
                  hint="Group steps by when they happen, such as before the first shift."
                  error={state.fieldErrors?.title?.[0]}
                >
                  {(p) => (
                    <Input {...p} name="title" maxLength={120} placeholder="e.g. Your first week" />
                  )}
                </Field>
              </>
            )}
          </ActionForm>
        </div>
      </div>
    </Card>
  )
}

function ReorderButton({
  templateId,
  kind,
  id,
  direction,
  disabled,
  label,
}: {
  templateId: string
  kind: 'section' | 'step'
  id: string
  direction: 'up' | 'down'
  disabled: boolean
  label: string
}) {
  return (
    <form action={reorderAction as unknown as (fd: FormData) => void}>
      <input type="hidden" name="templateId" value={templateId} />
      <input type="hidden" name="reorderKind" value={kind} />
      <input type="hidden" name="reorderId" value={id} />
      <input type="hidden" name="direction" value={direction} />
      <button
        type="submit"
        disabled={disabled}
        aria-label={label}
        className="border-line-strong text-muted hover:bg-sunk hover:text-ink inline-flex size-9 items-center justify-center rounded-md border disabled:cursor-not-allowed disabled:opacity-40"
      >
        <span aria-hidden="true">{direction === 'up' ? '↑' : '↓'}</span>
      </button>
    </form>
  )
}

interface StepDefaults {
  title: string
  instructions: string
  kind: string
  responsibility: string
  required: boolean
  dueOffsetDays: number | null
  dueOffsetBasis: string
  requiresManagerVerification: boolean
  blocksCompletion: boolean
  courseId: string | null
}

function StepFields({
  templateId,
  action,
  submitLabel,
  hidden,
  defaults,
  courses,
}: {
  templateId: string
  action: Parameters<typeof ActionForm>[0]['action']
  submitLabel: string
  hidden: Record<string, string>
  defaults?: StepDefaults
  courses: CourseOption[]
}) {
  const [kind, setKind] = useState(defaults?.kind ?? 'employee_task')
  const placeholder = PLACEHOLDER_KINDS.has(kind)
  const idPrefix = hidden.stepId ?? hidden.sectionId ?? 'new'

  return (
    <ActionForm action={action} submitLabel={submitLabel} variant="secondary">
      {(state) => (
        <>
          <input type="hidden" name="templateId" value={templateId} />
          {Object.entries(hidden).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}

          <Field
            id={`${idPrefix}-title`}
            label="Step"
            required
            error={state.fieldErrors?.title?.[0]}
          >
            {(p) => (
              <Input
                {...p}
                name="title"
                required
                maxLength={200}
                defaultValue={defaults?.title}
                placeholder="e.g. Shadow two dinner services"
              />
            )}
          </Field>

          <Field
            id={`${idPrefix}-instructions`}
            label="Instructions"
            hint="Shown to whoever is responsible."
          >
            {(p) => (
              <textarea
                {...p}
                name="instructions"
                rows={2}
                maxLength={1000}
                defaultValue={defaults?.instructions}
                className="border-field text-ink hover:border-faint rounded-control w-full border bg-white px-3 py-2.5 text-sm focus:border-teal-600"
              />
            )}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id={`${idPrefix}-kind`} label="Step type" required>
              {(p) => (
                <Select {...p} name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
                  {STEP_KINDS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field id={`${idPrefix}-responsibility`} label="Who is responsible" required>
              {(p) => (
                <Select
                  {...p}
                  name="responsibility"
                  defaultValue={defaults?.responsibility ?? 'employee'}
                >
                  {RESPONSIBILITIES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field
              id={`${idPrefix}-due`}
              label="Due after"
              hint="Days. Leave blank for no due date."
              error={state.fieldErrors?.dueOffsetDays?.[0]}
            >
              {(p) => (
                <Input
                  {...p}
                  name="dueOffsetDays"
                  type="number"
                  min={0}
                  max={365}
                  defaultValue={defaults?.dueOffsetDays ?? ''}
                />
              )}
            </Field>

            <Field
              id={`${idPrefix}-basis`}
              label="Counting from"
              hint="Which date the days are counted from."
            >
              {(p) => (
                <Select
                  {...p}
                  name="dueOffsetBasis"
                  defaultValue={defaults?.dueOffsetBasis ?? 'onboarding_start'}
                >
                  <option value="onboarding_start">Onboarding start</option>
                  <option value="hire_date">Hire date</option>
                </Select>
              )}
            </Field>
          </div>

          {kind === 'training_assignment' ? (
            <Field
              id={`${idPrefix}-course`}
              label="Course"
              required
              hint="The published course this person is given when onboarding starts. They keep that version even if the course is updated later."
              error={state.fieldErrors?.courseId?.[0]}
            >
              {(p) =>
                courses.length === 0 ? (
                  <p id={p.id} className="text-muted text-sm">
                    No published courses yet. Publish one under Training first.
                  </p>
                ) : (
                  <Select {...p} name="courseId" defaultValue={defaults?.courseId ?? ''} required>
                    <option value="" disabled>
                      Choose a course
                    </option>
                    {courses.map((course) => (
                      <option key={course.id} value={course.id}>
                        {course.title} (version {course.versionNumber})
                      </option>
                    ))}
                  </Select>
                )
              }
            </Field>
          ) : null}

          {placeholder ? (
            <p className="rounded-control border-warning/30 bg-warning-soft text-ink border px-3 py-2.5 text-sm">
              You can configure this step now. It will show as waiting on EverCalm until the policy
              library ships, so a new hire is never marked down for something we have not built.
            </p>
          ) : null}

          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">Step options</legend>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="required"
                defaultChecked={defaults?.required ?? true}
                className="mt-0.5 size-4"
              />
              <span className="text-ink">Required</span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="blocksCompletion"
                defaultChecked={defaults?.blocksCompletion ?? true}
                className="mt-0.5 size-4"
              />
              <span>
                <span className="text-ink">Holds up onboarding until it is done</span>
                <span className="text-muted block text-xs">
                  Uncheck for something worth tracking that should not stop somebody being ready.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="requiresManagerVerification"
                defaultChecked={defaults?.requiresManagerVerification ?? false}
                className="mt-0.5 size-4"
              />
              <span>
                <span className="text-ink">A manager must confirm this</span>
                <span className="text-muted block text-xs">
                  The employee cannot tick it off themselves, and whoever confirms is recorded.
                </span>
              </span>
            </label>
          </fieldset>
        </>
      )}
    </ActionForm>
  )
}

export { Button }
