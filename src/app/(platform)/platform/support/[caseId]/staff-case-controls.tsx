'use client'

import {
  staffCaseAssignAction,
  staffCaseNoteAction,
  staffCaseUpdateAction,
} from '@/modules/platform/actions'
import { MiniForm } from '@/ui/patterns/mini-form'
import { NoticeProvider } from '@/ui/patterns/notice-provider'
import { Card, CardHeader, Field, Select, Textarea } from '@/ui/primitives'

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
                {(p) => <Textarea {...p} name="body" rows={5} maxLength={5000} />}
              </Field>
              <Field id="staff-status" label="Status after sending">
                {(p) => (
                  <Select {...p} name="status" defaultValue={status}>
                    {statuses.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </Select>
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
                {(p) => <Textarea {...p} name="body" rows={3} maxLength={5000} required />}
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
                  <Select {...p} name="assignee" defaultValue={assignedStaffUserId ?? ''}>
                    <option value="">Nobody</option>
                    {colleagues.map((c) => (
                      <option key={c.userId} value={c.userId}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </MiniForm>
          </div>
        </Card>
      </div>
    </NoticeProvider>
  )
}
