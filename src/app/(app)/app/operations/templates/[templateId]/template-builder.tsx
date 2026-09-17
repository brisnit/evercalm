'use client'

import {
  addSectionAction,
  addTaskAction,
  archiveTemplateAction,
  discardDraftAction,
  moveSectionAction,
  moveTaskAction,
  publishDraftAction,
  removeSectionAction,
  removeTaskAction,
  renameSectionAction,
  restoreTemplateAction,
  setDraftTargetsAction,
  startNewDraftAction,
  updateDraftDetailsAction,
  updateTaskAction,
} from '@/modules/operations/actions'
import type { TaskDetail, TemplateOptions } from '@/modules/operations/templates'
import { MiniForm } from '@/ui/patterns/mini-form'
import { NoticeProvider } from '@/ui/patterns/notice-provider'
import { ConfirmAction } from '@/ui/patterns/confirm-action'
import { Badge, Card, CardHeader, Disclosure, EmptyState, Field, Input } from '@/ui/primitives'
import { SELECT_CLASS, TEXTAREA_CLASS } from '../../../training/_components/styles'

export interface VersionView {
  id: string
  versionNumber: number
  name: string
  kind: string
  kindLabel: string
  description: string
  targets: { locationIds: string[]; jobRoleIds: string[]; stationIds: string[] }
  targetLine: string
  publishedLine: string | null
  sections: {
    id: string
    title: string
    tasks: (TaskDetail & { timingLine: string; responseLabel: string })[]
  }[]
  problems: string[]
  taskCount: number
}

interface Props {
  templateId: string
  archived: boolean
  canEdit: boolean
  draft: VersionView | null
  published: VersionView | null
  history: {
    id: string
    versionNumber: number
    isCurrent: boolean
    label: string
    changeNote: string
  }[]
  options: TemplateOptions | null
  kinds: { value: string; label: string }[]
  responseTypes: { value: string; label: string }[]
}

export function TemplateBuilder(props: Props) {
  const { draft, published, canEdit, archived, options } = props
  const editing = canEdit && !archived && draft !== null && options !== null

  return (
    <NoticeProvider>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start [&>*]:min-w-0">
        <div className="flex min-w-0 flex-col gap-5">
          {editing ? (
            <>
              <Card>
                <CardHeader
                  title={`Draft of version ${draft.versionNumber}`}
                  description="Changes here affect nobody until the draft is published."
                />
                <div className="p-5">
                  <MiniForm
                    action={updateDraftDetailsAction}
                    hidden={{ versionId: draft.id }}
                    submitLabel="Save details"
                  >
                    {(state) => (
                      <>
                        <Field
                          id="draft-name"
                          label="Name"
                          required
                          error={state.fieldErrors?.name?.[0]}
                        >
                          {(p) => (
                            <Input
                              {...p}
                              name="name"
                              defaultValue={draft.name}
                              maxLength={80}
                              required
                            />
                          )}
                        </Field>
                        <Field id="draft-kind" label="Kind of work" required>
                          {(p) => (
                            <select
                              {...p}
                              name="kind"
                              defaultValue={draft.kind}
                              className={SELECT_CLASS}
                            >
                              {props.kinds.map((k) => (
                                <option key={k.value} value={k.value}>
                                  {k.label}
                                </option>
                              ))}
                            </select>
                          )}
                        </Field>
                        <Field
                          id="draft-description"
                          label="Description"
                          hint="Optional. Managers see it here."
                        >
                          {(p) => (
                            <textarea
                              {...p}
                              name="description"
                              rows={2}
                              maxLength={600}
                              defaultValue={draft.description}
                              className={TEXTAREA_CLASS}
                            />
                          )}
                        </Field>
                      </>
                    )}
                  </MiniForm>
                </div>
              </Card>

              <Card>
                <CardHeader title="Who does this" description={draft.targetLine} />
                <div className="p-5">
                  <TargetsForm draft={draft} options={options} />
                </div>
              </Card>

              {draft.sections.length === 0 ? (
                <EmptyState
                  title="No tasks yet"
                  description="Add a section - “Before doors open”, “Bar”, “Last hour” - then its tasks."
                />
              ) : null}
              {draft.sections.map((section, index) => (
                <Card key={section.id} as="section">
                  <div className="border-line flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3">
                    <h2 className="font-display text-ink text-base font-bold">{section.title}</h2>
                    <div className="flex flex-wrap gap-1">
                      <MoveButton
                        action={moveSectionAction}
                        name="sectionId"
                        id={section.id}
                        direction="up"
                        disabled={index === 0}
                        label={`Move ${section.title} up`}
                      />
                      <MoveButton
                        action={moveSectionAction}
                        name="sectionId"
                        id={section.id}
                        direction="down"
                        disabled={index === draft.sections.length - 1}
                        label={`Move ${section.title} down`}
                      />
                    </div>
                  </div>
                  {section.tasks.length === 0 ? (
                    <p className="text-muted px-5 py-4 text-sm">No tasks in this section yet.</p>
                  ) : null}
                  <ol className="divide-line divide-y">
                    {section.tasks.map((task, taskIndex) => (
                      <li key={task.id} className="px-5 py-4">
                        <TaskSummary task={task} />
                        <div className="mt-2 flex flex-wrap gap-1">
                          <MoveButton
                            action={moveTaskAction}
                            name="taskId"
                            id={task.id}
                            direction="up"
                            disabled={taskIndex === 0}
                            label={`Move ${task.title} up`}
                          />
                          <MoveButton
                            action={moveTaskAction}
                            name="taskId"
                            id={task.id}
                            direction="down"
                            disabled={taskIndex === section.tasks.length - 1}
                            label={`Move ${task.title} down`}
                          />
                        </div>
                        <Disclosure label={`Edit “${task.title}”`} className="mt-2">
                          <MiniForm
                            action={updateTaskAction}
                            hidden={{ taskId: task.id }}
                            submitLabel="Save task"
                          >
                            {(state) => (
                              <TaskFields
                                prefix={task.id}
                                task={task}
                                responseTypes={props.responseTypes}
                                errors={state.fieldErrors}
                              />
                            )}
                          </MiniForm>
                          <div className="mt-3">
                            <MiniForm
                              action={removeTaskAction}
                              hidden={{ taskId: task.id }}
                              submitLabel="Remove task"
                              variant="ghost"
                            />
                          </div>
                        </Disclosure>
                      </li>
                    ))}
                  </ol>
                  <div className="border-line bg-raise flex flex-col gap-3 border-t p-5">
                    <Disclosure label={`Add a task to ${section.title}`}>
                      <MiniForm
                        action={addTaskAction}
                        hidden={{ sectionId: section.id }}
                        submitLabel="Add task"
                      >
                        {(state) => (
                          <TaskFields
                            prefix={`new-${section.id}`}
                            task={null}
                            responseTypes={props.responseTypes}
                            errors={state.fieldErrors}
                          />
                        )}
                      </MiniForm>
                    </Disclosure>
                    <Disclosure label="Rename or remove this section">
                      <MiniForm
                        action={renameSectionAction}
                        hidden={{ sectionId: section.id }}
                        submitLabel="Rename"
                      >
                        {(state) => (
                          <Field
                            id={`section-title-${section.id}`}
                            label="Section title"
                            required
                            error={state.fieldErrors?.title?.[0]}
                          >
                            {(p) => (
                              <Input
                                {...p}
                                name="title"
                                defaultValue={section.title}
                                maxLength={80}
                                required
                              />
                            )}
                          </Field>
                        )}
                      </MiniForm>
                      <div className="mt-3">
                        <MiniForm
                          action={removeSectionAction}
                          hidden={{ sectionId: section.id }}
                          submitLabel="Remove section and its tasks"
                          variant="ghost"
                        />
                      </div>
                    </Disclosure>
                  </div>
                </Card>
              ))}

              <Card>
                <div className="p-5">
                  <MiniForm
                    action={addSectionAction}
                    hidden={{ versionId: draft.id }}
                    submitLabel="Add section"
                  >
                    {(state) => (
                      <Field
                        id="new-section"
                        label="New section"
                        required
                        error={state.fieldErrors?.title?.[0]}
                      >
                        {(p) => (
                          <Input
                            {...p}
                            name="title"
                            maxLength={80}
                            required
                            autoComplete="off"
                            placeholder="Before doors open"
                          />
                        )}
                      </Field>
                    )}
                  </MiniForm>
                </div>
              </Card>
            </>
          ) : (published ?? draft) ? (
            <ReadOnlyVersion version={(published ?? draft)!} />
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          {editing ? (
            <Card>
              <CardHeader
                title="Publish"
                description={
                  published
                    ? 'Shifts that do not have this work yet get the new version. Shifts that already have it keep the version they were given.'
                    : 'Every matching shift already published for the next three weeks gets this work, and so does every shift published after.'
                }
              />
              <div className="flex flex-col gap-4 p-5">
                {draft.problems.length > 0 ? (
                  <ul className="text-warning flex list-disc flex-col gap-1 pl-5 text-sm">
                    {draft.problems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                ) : null}
                <MiniForm
                  action={publishDraftAction}
                  hidden={{ versionId: draft.id }}
                  submitLabel={`Publish version ${draft.versionNumber}`}
                  variant="primary"
                >
                  {(state) =>
                    published ? (
                      <Field
                        id="change-note"
                        label="What changed"
                        required
                        error={state.fieldErrors?.changeNote?.[0]}
                      >
                        {(p) => (
                          <textarea
                            {...p}
                            name="changeNote"
                            rows={2}
                            maxLength={300}
                            required
                            className={TEXTAREA_CLASS}
                          />
                        )}
                      </Field>
                    ) : null
                  }
                </MiniForm>
                {published ? (
                  <ConfirmAction
                    triggerLabel="Discard draft"
                    title="Discard this draft?"
                    description={`Version ${published.versionNumber} stays published and nothing changes for anyone.`}
                  >
                    <MiniForm
                      action={discardDraftAction}
                      hidden={{ versionId: draft.id }}
                      submitLabel="Discard draft"
                      variant="danger"
                    />
                  </ConfirmAction>
                ) : null}
              </div>
            </Card>
          ) : canEdit && !archived && published && !draft ? (
            <Card>
              <CardHeader
                title="Change this template"
                description="Start a new draft. Nothing changes for anyone until you publish it."
              />
              <div className="p-5">
                <MiniForm
                  action={startNewDraftAction}
                  hidden={{ templateId: props.templateId }}
                  submitLabel="Start a new draft"
                  variant="primary"
                />
              </div>
            </Card>
          ) : null}

          {!canEdit ? (
            <Card className="p-5">
              <p className="text-muted text-sm">
                You can view this template. Changing it needs the “Author checklists” permission for
                every location it applies to.
              </p>
            </Card>
          ) : null}

          <Card>
            <CardHeader
              title="Versions"
              description="Each published version stays exactly as it was."
            />
            {props.history.length === 0 ? (
              <p className="text-muted p-5 text-sm">Not published yet.</p>
            ) : (
              <ol className="divide-line divide-y">
                {props.history.map((h) => (
                  <li key={h.id} className="px-5 py-3 text-sm">
                    <p className="text-ink font-medium">
                      Version {h.versionNumber}{' '}
                      {h.isCurrent ? <Badge tone="success">Current</Badge> : null}
                    </p>
                    <p className="text-muted">{h.label}</p>
                    {h.changeNote ? <p className="text-ink/85 mt-0.5">{h.changeNote}</p> : null}
                  </li>
                ))}
              </ol>
            )}
          </Card>

          {canEdit ? (
            <Card className="p-5">
              {archived ? (
                <MiniForm
                  action={restoreTemplateAction}
                  hidden={{ templateId: props.templateId }}
                  submitLabel="Restore template"
                />
              ) : (
                <ConfirmAction
                  triggerLabel="Archive template"
                  title="Archive this template?"
                  description="No new shifts will get this work. Shifts that already have it keep it, and its history stays."
                >
                  <MiniForm
                    action={archiveTemplateAction}
                    hidden={{ templateId: props.templateId }}
                    submitLabel="Archive"
                    variant="danger"
                  />
                </ConfirmAction>
              )}
            </Card>
          ) : null}
        </div>
      </div>
    </NoticeProvider>
  )
}

function MoveButton({
  action,
  name,
  id,
  direction,
  disabled,
  label,
}: {
  action: (formData: FormData) => Promise<void>
  name: string
  id: string
  direction: 'up' | 'down'
  disabled: boolean
  label: string
}) {
  return (
    <form action={action}>
      <input type="hidden" name={name} value={id} />
      <input type="hidden" name="direction" value={direction} />
      <button
        type="submit"
        disabled={disabled}
        aria-label={label}
        className="rounded-control border-line-strong text-muted hover:bg-sunk hover:text-ink inline-flex min-h-11 min-w-11 items-center justify-center border bg-white text-sm disabled:opacity-40"
      >
        <span aria-hidden="true">{direction === 'up' ? '↑' : '↓'}</span>
      </button>
    </form>
  )
}

function TaskSummary({ task }: { task: VersionView['sections'][number]['tasks'][number] }) {
  return (
    <div>
      <p className="text-ink font-medium">{task.title}</p>
      <p className="text-muted text-sm">
        {task.timingLine} · {task.responseLabel}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <Badge tone={task.required ? 'neutral' : 'info'}>
          {task.required ? 'Required' : 'Optional'}
        </Badge>
        {task.requiresVerification ? <Badge tone="accent">Manager verifies</Badge> : null}
        {task.shared ? <Badge tone="neutral">Shared</Badge> : null}
      </div>
      {task.instructions ? (
        <p className="text-ink/80 mt-2 text-sm whitespace-pre-line">{task.instructions}</p>
      ) : null}
    </div>
  )
}

function TaskFields({
  prefix,
  task,
  responseTypes,
  errors,
}: {
  prefix: string
  task: TaskDetail | null
  responseTypes: { value: string; label: string }[]
  errors?: Record<string, string[]>
}) {
  const offset = task?.offsetMinutes ?? 0
  return (
    <>
      <Field id={`${prefix}-title`} label="Task" required error={errors?.title?.[0]}>
        {(p) => (
          <Input
            {...p}
            name="title"
            defaultValue={task?.title ?? ''}
            maxLength={140}
            required
            autoComplete="off"
          />
        )}
      </Field>
      <Field
        id={`${prefix}-instructions`}
        label="How to do it"
        hint="Optional. Shown to the person doing it."
      >
        {(p) => (
          <textarea
            {...p}
            name="instructions"
            rows={3}
            maxLength={1500}
            defaultValue={task?.instructions ?? ''}
            className={TEXTAREA_CLASS}
          />
        )}
      </Field>
      <Field id={`${prefix}-response`} label="Completed with" error={errors?.responseType?.[0]}>
        {(p) => (
          <select
            {...p}
            name="responseType"
            defaultValue={task?.responseType ?? 'check'}
            className={SELECT_CLASS}
          >
            {responseTypes.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-ink text-sm font-medium">Due</legend>
        {errors?.offsetMinutes?.[0] ? (
          <p role="alert" className="text-danger text-xs font-medium">
            {errors.offsetMinutes[0]}
          </p>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted">Minutes</span>
            <Input
              name="offsetAmount"
              type="number"
              min={0}
              max={720}
              step={5}
              defaultValue={Math.abs(offset)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted">Before or after</span>
            <select
              name="offsetDirection"
              defaultValue={offset < 0 ? 'before' : 'after'}
              className={SELECT_CLASS}
            >
              <option value="before">before</option>
              <option value="after">after</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted">The shift</span>
            <select
              name="timingAnchor"
              defaultValue={task?.timingAnchor ?? 'shift_start'}
              className={SELECT_CLASS}
            >
              <option value="shift_start">starts</option>
              <option value="shift_end">ends</option>
            </select>
          </label>
        </div>
      </fieldset>
      <div className="flex flex-col">
        <label className="text-ink flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            name="required"
            defaultChecked={task?.required ?? true}
            className="size-5 accent-teal-600"
          />
          Required
        </label>
        <label className="text-ink flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            name="requiresVerification"
            defaultChecked={task?.requiresVerification ?? false}
            className="size-5 accent-teal-600"
          />
          A manager verifies it
        </label>
        <label className="text-ink flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            name="shared"
            defaultChecked={task?.shared ?? false}
            className="size-5 accent-teal-600"
          />
          Shared: anyone on shift at the location that day can do it
        </label>
      </div>
    </>
  )
}

function TargetsForm({ draft, options }: { draft: VersionView; options: TemplateOptions }) {
  const byLocation = new Map<string, { name: string; stations: TemplateOptions['stations'] }>()
  for (const station of options.stations) {
    const entry = byLocation.get(station.locationId) ?? { name: station.locationName, stations: [] }
    entry.stations.push(station)
    byLocation.set(station.locationId, entry)
  }
  return (
    <MiniForm
      action={setDraftTargetsAction}
      hidden={{ versionId: draft.id }}
      submitLabel="Save who does this"
    >
      {(state) => (
        <>
          <fieldset className="flex flex-col">
            <legend className="text-ink text-sm font-medium">Locations</legend>
            <p className="text-muted text-xs">
              {options.mayTargetEveryLocation
                ? 'None ticked means every location.'
                : 'Choose at least one.'}
            </p>
            {state.fieldErrors?.locationIds?.[0] ? (
              <p role="alert" className="text-danger text-xs font-medium">
                {state.fieldErrors.locationIds[0]}
              </p>
            ) : null}
            {options.locations.map((l) => (
              <label key={l.id} className="text-ink flex min-h-11 items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  name="locationIds"
                  value={l.id}
                  defaultChecked={draft.targets.locationIds.includes(l.id)}
                  className="size-5 accent-teal-600"
                />
                {l.name}
              </label>
            ))}
          </fieldset>
          <fieldset className="flex flex-col">
            <legend className="text-ink text-sm font-medium">Job roles</legend>
            <p className="text-muted text-xs">None ticked means any role.</p>
            <div className="grid sm:grid-cols-2">
              {options.jobRoles.map((r) => (
                <label key={r.id} className="text-ink flex min-h-11 items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    name="jobRoleIds"
                    value={r.id}
                    defaultChecked={draft.targets.jobRoleIds.includes(r.id)}
                    className="size-5 accent-teal-600"
                  />
                  {r.name}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="flex flex-col">
            <legend className="text-ink text-sm font-medium">Stations</legend>
            <p className="text-muted text-xs">None ticked means any station, or none.</p>
            {state.fieldErrors?.stationIds?.[0] ? (
              <p role="alert" className="text-danger text-xs font-medium">
                {state.fieldErrors.stationIds[0]}
              </p>
            ) : null}
            {[...byLocation.entries()].map(([locationId, group]) => (
              <div key={locationId} className="mt-1">
                <p className="text-faint text-xs font-semibold">{group.name}</p>
                <div className="grid sm:grid-cols-2">
                  {group.stations.map((s) => (
                    <label key={s.id} className="text-ink flex min-h-11 items-center gap-3 text-sm">
                      <input
                        type="checkbox"
                        name="stationIds"
                        value={s.id}
                        defaultChecked={draft.targets.stationIds.includes(s.id)}
                        className="size-5 accent-teal-600"
                      />
                      {s.name}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </fieldset>
        </>
      )}
    </MiniForm>
  )
}

function ReadOnlyVersion({ version }: { version: VersionView }) {
  return (
    <>
      <Card>
        <CardHeader
          title={`Version ${version.versionNumber}`}
          description={[
            version.publishedLine,
            `${version.taskCount} ${version.taskCount === 1 ? 'task' : 'tasks'}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        />
        <p className="text-muted px-5 py-4 text-sm">
          <span className="text-ink font-medium">Applies to:</span> {version.targetLine}
        </p>
      </Card>
      {version.sections.map((section) => (
        <Card key={section.id} as="section">
          <CardHeader title={section.title} />
          <ol className="divide-line divide-y">
            {section.tasks.map((task) => (
              <li key={task.id} className="px-5 py-4">
                <TaskSummary task={task} />
              </li>
            ))}
          </ol>
        </Card>
      ))}
    </>
  )
}
