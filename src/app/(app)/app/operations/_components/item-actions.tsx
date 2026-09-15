'use client'

import {
  reassignTaskAction,
  reopenTaskAction,
  returnTaskAction,
  verifyTaskAction,
} from '@/modules/operations/actions'
import { MiniForm } from '@/ui/patterns/mini-form'
import { Disclosure, Field } from '@/ui/primitives'

const TEXTAREA =
  'rounded-control border-line-strong text-ink placeholder:text-faint w-full border bg-white px-3 py-2.5 text-sm leading-relaxed hover:border-faint focus:border-violet-600'
const SELECT =
  'rounded-control border-line-strong text-ink min-h-11 w-full border bg-white px-3 text-sm hover:border-faint focus:border-violet-600'

/**
 * What a manager can do about one task, given its status and their
 * capabilities at the location. The server checks all of it again.
 */
export function ItemActions({
  itemId,
  revision,
  title,
  status,
  completedByMe,
  assignedEmploymentId,
  canVerify,
  canReopen,
  people,
}: {
  itemId: string
  revision: number
  title: string
  status: string
  completedByMe: boolean
  assignedEmploymentId: string | null
  canVerify: boolean
  canReopen: boolean
  people: { id: string; name: string }[]
}) {
  const hidden = { itemId, revision }
  const others = people.filter((p) => p.id !== assignedEmploymentId)
  const verify = canVerify && status === 'awaiting_verification' && !completedByMe
  const sendBack = canVerify && (status === 'awaiting_verification' || status === 'done')
  const reassign = canVerify && (status === 'pending' || status === 'blocked') && others.length > 0
  const reopen = canReopen && (status === 'done' || status === 'skipped')
  if (!verify && !sendBack && !reassign && !reopen) return null

  return (
    <div className="mt-3 flex flex-col gap-2">
      {verify ? (
        <MiniForm
          action={verifyTaskAction}
          hidden={hidden}
          submitLabel={`Verify “${title}”`}
          variant="primary"
        />
      ) : null}
      {canVerify && status === 'awaiting_verification' && completedByMe ? (
        <p className="text-muted text-sm">You did this, so someone else needs to verify it.</p>
      ) : null}
      {sendBack ? (
        <Disclosure label="Send back">
          <MiniForm action={returnTaskAction} hidden={hidden} submitLabel="Send back">
            {(state) => (
              <Field
                id={`return-${itemId}`}
                label="What needs another look"
                required
                error={state.fieldErrors?.note?.[0]}
              >
                {(p) => (
                  <textarea
                    {...p}
                    name="note"
                    rows={2}
                    maxLength={300}
                    required
                    className={TEXTAREA}
                  />
                )}
              </Field>
            )}
          </MiniForm>
        </Disclosure>
      ) : null}
      {reassign ? (
        <Disclosure label="Reassign">
          <MiniForm action={reassignTaskAction} hidden={hidden} submitLabel="Reassign">
            {(state) => (
              <>
                <Field
                  id={`to-${itemId}`}
                  label="Give it to"
                  required
                  error={state.fieldErrors?.toEmploymentId?.[0]}
                >
                  {(p) => (
                    <select
                      {...p}
                      name="toEmploymentId"
                      defaultValue=""
                      required
                      className={SELECT}
                    >
                      <option value="" disabled>
                        Someone on shift
                      </option>
                      {others.map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.name}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field id={`note-${itemId}`} label="Note" hint="Optional. They are told.">
                  {(p) => (
                    <textarea {...p} name="note" rows={2} maxLength={300} className={TEXTAREA} />
                  )}
                </Field>
              </>
            )}
          </MiniForm>
        </Disclosure>
      ) : null}
      {reopen ? (
        <Disclosure label="Reopen">
          <MiniForm action={reopenTaskAction} hidden={hidden} submitLabel="Reopen">
            <Field id={`reopen-${itemId}`} label="Why" hint="Optional. The person is told.">
              {(p) => <textarea {...p} name="note" rows={2} maxLength={300} className={TEXTAREA} />}
            </Field>
          </MiniForm>
        </Disclosure>
      ) : null}
    </div>
  )
}
