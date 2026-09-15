'use client'

import { useState } from 'react'
import {
  archiveAnnouncementAction,
  cancelScheduleAction,
  duplicateAnnouncementAction,
  publishAnnouncementAction,
  reviseAnnouncementAction,
  scheduleAnnouncementAction,
  syncRecipientsAction,
} from '@/modules/comms/actions'
import { ActionForm } from '@/ui/patterns/action-form'
import { ActionNotice, useActionNotice } from '@/ui/patterns/action-notice'
import { ConfirmAction } from '@/ui/patterns/confirm-action'
import { Card, CardHeader, Field, Input } from '@/ui/primitives'

/**
 * Publish, schedule, correct, archive.
 *
 * Publication is always behind a confirmation that states the audience in
 * words and the count in numbers, because it is the one action here that
 * cannot be taken back: recipients are created and people are notified.
 * Emergency gets a second, differently worded confirmation - it overrides
 * every preference and quiet hour somebody set, and that deserves a sentence
 * saying so rather than a red button.
 *
 * Success messages are shown in a notice held HERE, not inside each form:
 * publishing removes the Publish card, scheduling removes the schedule form,
 * and a message rendered inside them disappeared with them.
 */
export function LifecycleActions({
  announcementId,
  status,
  priority,
  title,
  body,
  callToActionLabel,
  callToActionHref,
  audienceSummary,
  audienceCount,
  requiresAcknowledgement,
  permissions,
  timeZone,
  scheduledLabel,
}: {
  announcementId: string
  status: string
  priority: string
  title: string
  body: string
  callToActionLabel: string
  callToActionHref: string
  audienceSummary: string
  audienceCount: number
  requiresAcknowledgement: boolean
  permissions: { mayPublish: boolean; mayArchive: boolean; mayEmergency: boolean }
  /** The organization's timezone: what a typed date and time means. */
  timeZone: string
  /** When a scheduled announcement goes out, already formatted in that zone. */
  scheduledLabel: string | null
}) {
  const [revising, setRevising] = useState(false)
  const { notice, show, dismiss } = useActionNotice()

  const canPublishNow = (status === 'draft' || status === 'scheduled') && permissions.mayPublish
  const isEmergency = priority === 'emergency'

  return (
    <div className="flex flex-col gap-5">
      <ActionNotice notice={notice} onDismiss={dismiss} />

      {canPublishNow ? (
        <Card>
          <CardHeader
            title="Publish"
            description={
              audienceCount === 0
                ? 'Add an audience before this can go out.'
                : `${audienceCount} ${audienceCount === 1 ? 'person' : 'people'} will receive it.`
            }
          />
          <div className="flex flex-col gap-4 p-5">
            {audienceCount > 0 ? (
              <ConfirmAction
                triggerLabel={isEmergency ? 'Send emergency announcement' : 'Publish now'}
                title={isEmergency ? 'Send this as an emergency?' : 'Publish this announcement?'}
                description={
                  isEmergency
                    ? `This goes to ${audienceCount} ${
                        audienceCount === 1 ? 'person' : 'people'
                      } — ${audienceSummary}. An emergency ignores every notification preference and quiet hour those people have set, and is recorded in the audit log as an emergency. Use it when not reaching somebody is worse than waking them.`
                    : `This goes to ${audienceCount} ${
                        audienceCount === 1 ? 'person' : 'people'
                      } — ${audienceSummary}.${
                        requiresAcknowledgement
                          ? ' They will be asked to confirm they have read it.'
                          : ''
                      } It is in their inbox straight away; anyone in their quiet hours is notified when those end, unless this is an urgent safety or HR notice. You cannot unsend it; you can archive it afterwards.`
                }
              >
                <ActionForm
                  action={publishAnnouncementAction}
                  submitLabel={isEmergency ? 'Yes, send it now' : 'Yes, publish it'}
                  destructive={isEmergency}
                  onSuccess={show}
                >
                  <input type="hidden" name="announcementId" value={announcementId} />
                </ActionForm>
              </ConfirmAction>
            ) : null}

            {status === 'draft' ? (
              <ActionForm
                action={scheduleAnnouncementAction}
                submitLabel="Schedule it"
                variant="secondary"
                onSuccess={show}
              >
                {(state) => (
                  <>
                    <input type="hidden" name="announcementId" value={announcementId} />
                    <Field
                      id="publishAt"
                      label="Send at"
                      hint={`In ${timeZone} time. Nobody receives anything until then, and you can cancel before it goes.`}
                      error={state.fieldErrors?.publishAt?.[0]}
                    >
                      {(p) => <Input {...p} type="datetime-local" name="publishAt" required />}
                    </Field>
                  </>
                )}
              </ActionForm>
            ) : null}

            {status === 'scheduled' ? (
              <ActionForm
                action={cancelScheduleAction}
                submitLabel="Cancel the schedule"
                variant="secondary"
                onSuccess={show}
              >
                <input type="hidden" name="announcementId" value={announcementId} />
                {scheduledLabel ? (
                  <p className="text-ink text-sm">
                    Goes out <span className="font-semibold">{scheduledLabel}</span>, automatically.
                  </p>
                ) : null}
                <p className="text-muted text-sm">
                  Cancelling returns it to a draft. Nobody has received anything yet.
                </p>
              </ActionForm>
            ) : null}
          </div>
        </Card>
      ) : null}

      {status === 'published' ? (
        <Card>
          <CardHeader
            title="Correct it"
            description="Published wording is never edited in place. A correction is a new revision, and the old one is kept."
          />
          <div className="p-5">
            {!revising ? (
              <button
                type="button"
                onClick={() => setRevising(true)}
                className="rounded-control border-line-strong text-ink hover:bg-sunk min-h-11 border bg-white px-4 text-sm font-medium"
              >
                Publish a correction
              </button>
            ) : (
              <ActionForm
                action={reviseAnnouncementAction}
                submitLabel="Publish the correction"
                onSuccess={(state) => {
                  show(state)
                  setRevising(false)
                }}
              >
                {(state) => (
                  <>
                    <input type="hidden" name="announcementId" value={announcementId} />
                    <Field
                      id="rev-title"
                      label="Title"
                      required
                      error={state.fieldErrors?.title?.[0]}
                    >
                      {(p) => <Input {...p} name="title" required defaultValue={title} />}
                    </Field>
                    <Field id="rev-body" label="Message" required>
                      {(p) => (
                        <textarea
                          {...p}
                          name="body"
                          required
                          rows={10}
                          defaultValue={body}
                          className="rounded-control border-field text-ink w-full border bg-white px-3 py-2.5 text-sm"
                        />
                      )}
                    </Field>
                    <input type="hidden" name="callToActionLabel" value={callToActionLabel} />
                    <input type="hidden" name="callToActionHref" value={callToActionHref} />

                    <Field
                      id="rev-note"
                      label="What changed"
                      hint="Shown to people who are asked to confirm again."
                    >
                      {(p) => (
                        <Input {...p} name="note" placeholder="e.g. Corrected the cut-off time" />
                      )}
                    </Field>

                    <label className="flex items-start gap-2.5 text-sm">
                      <input type="checkbox" name="isMaterial" className="mt-0.5 h-4 w-4" />
                      <span>
                        <span className="text-ink font-medium">The meaning changed</span>
                        <span className="text-muted block text-xs">
                          {requiresAcknowledgement
                            ? 'Everyone who already confirmed will be asked again. Their earlier confirmation is kept.'
                            : 'Marks the revision as material in the history.'}
                        </span>
                      </span>
                    </label>
                  </>
                )}
              </ActionForm>
            )}
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Manage" />
        <div className="flex flex-col gap-3 p-5">
          {status === 'published' ? (
            <ActionForm
              action={syncRecipientsAction}
              submitLabel="Add newly matching people"
              variant="secondary"
              onSuccess={show}
            >
              <input type="hidden" name="announcementId" value={announcementId} />
              <p className="text-muted text-sm">
                Recipients were fixed at publication. This adds anyone who matches the audience now
                and does not already have it. Nobody receives it twice.
              </p>
            </ActionForm>
          ) : null}

          <ActionForm
            action={duplicateAnnouncementAction}
            submitLabel="Duplicate"
            variant="secondary"
          >
            <input type="hidden" name="announcementId" value={announcementId} />
            <p className="text-muted text-sm">
              Copies the wording and the audience into a new draft. The original is untouched.
            </p>
          </ActionForm>

          {permissions.mayArchive && status !== 'archived' ? (
            <ConfirmAction
              triggerLabel="Archive"
              title="Archive this announcement?"
              description="It leaves people's active inboxes and stops any queued notification. Read and acknowledgement receipts are kept, and people can still find it under Archived."
            >
              <ActionForm
                action={archiveAnnouncementAction}
                submitLabel="Archive it"
                destructive
                onSuccess={show}
              >
                <input type="hidden" name="announcementId" value={announcementId} />
              </ActionForm>
            </ConfirmAction>
          ) : null}
        </div>
      </Card>
    </div>
  )
}
