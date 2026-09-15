'use client'

import {
  staffCaseAssignAction,
  staffCaseNoteAction,
  staffCaseUpdateAction,
} from '@/modules/platform/actions'
import { MiniForm } from '@/ui/patterns/mini-form'
import { NoticeProvider } from '@/ui/patterns/notice-provider'
import { Card, CardHeader, Field } from '@/ui/primitives'

const TEXTAREA =
  'rounded-control border-line-strong text-ink placeholder:text-faint w-full border bg-white px-3 py-2.5 text-sm leading-relaxed hover:border-faint focus:border-violet-600'
const SELECT =
  'rounded-control border-line-strong text-ink min-h-11 w-full border bg-white px-3 text-sm hover:border-faint focus:border-violet-600'

export function StaffCaseControls({
  caseId,
  status,
  assignedStaffUserId,
  colleagues,
  statuses,
}: {
  caseId: string
  status: string
  assignedStaffUserId: string | null
  colleagues: { userId: string; name: string }[]
  statuses: { value: string; label: string }[]
}) {
  return (
    <NoticeProvider>
      <div className="flex min-w-0 flex-col gap-4">
        <Card as="section">
          <CardHeader
            title="Reply to the customer"
            description="The customer sees this and is notified."
          />
          <div className="p-5">
            <MiniForm
              action={staffCaseUpdateAction}
              hidden={{ caseId }}
              submitLabel="Send"
              variant="primary"
            >
              <Field id="staff-reply" label="Reply">
                {(p) => (
                  <textarea {...p} name="body" rows={5} maxLength={5000} className={TEXTAREA} />
                )}
              </Field>
              <Field id="staff-status" label="Status after sending">
                {(p) => (
                  <select {...p} name="status" defaultValue={status} className={SELECT}>
                    {statuses.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </MiniForm>
          </div>
        </Card>
        <Card as="section" className="border-warning/40 border-dashed">
          <CardHeader title="Internal note" description="Only the EverCalm team can see this." />
          <div className="p-5">
            <MiniForm
              action={staffCaseNoteAction}
              hidden={{ caseId }}
              submitLabel="Save internal note"
            >
              <Field id="staff-note" label="Note" required>
                {(p) => (
                  <textarea
                    {...p}
                    name="body"
                    rows={3}
                    maxLength={5000}
                    required
                    className={TEXTAREA}
                  />
                )}
              </Field>
            </MiniForm>
          </div>
        </Card>
        <Card as="section">
          <CardHeader title="Assignment" />
          <div className="p-5">
            <MiniForm
              action={staffCaseAssignAction}
              hidden={{ caseId }}
              submitLabel="Save assignment"
            >
              <Field id="staff-assignee" label="Assigned to">
                {(p) => (
                  <select
                    {...p}
                    name="assignee"
                    defaultValue={assignedStaffUserId ?? ''}
                    className={SELECT}
                  >
                    <option value="">Nobody</option>
                    {colleagues.map((c) => (
                      <option key={c.userId} value={c.userId}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </MiniForm>
          </div>
        </Card>
      </div>
    </NoticeProvider>
  )
}
