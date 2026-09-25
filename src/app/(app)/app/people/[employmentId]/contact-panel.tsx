'use client'

import { useState } from 'react'
import { formatCalendarDate } from '@/lib/dates'
import { changeContactDetailsAction } from '@/modules/people/actions'
import { ContactFields } from '@/ui/patterns/contact-fields'
import { MiniForm } from '@/ui/patterns/mini-form'
import { Button, Card, CardHeader } from '@/ui/primitives'

/**
 * Contact details on someone's profile, readable and — for a manager who is
 * allowed to see them — editable in place.
 *
 * Round 2: "no way to edit the contact field" was the stakeholder's complaint.
 * Editing opens in the card rather than on another screen, because changing a
 * phone number should not feel like a workflow.
 */
export function ContactPanel({
  employmentId,
  contact,
  canEdit,
}: {
  employmentId: string
  contact: {
    email: string | null
    phone: string | null
    dateOfBirth: string | null
    emergencyContactName: string | null
    emergencyContactPhone: string | null
  } | null
  canEdit: boolean
}) {
  const [editing, setEditing] = useState(false)

  if (!contact) {
    return (
      <Card>
        <CardHeader title="Contact" />
        <div className="p-5">
          <div className="rounded-control border-line bg-sunk border px-4 py-3">
            <p className="text-ink text-sm font-medium">Withheld</p>
            <p className="text-muted mt-1 text-sm">
              Emergency contacts, date of birth and personal contact details need the
              sensitive-information permission, which General Managers do not hold.
            </p>
          </div>
        </div>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader
        title="Contact"
        description="Personal details, visible to you because you hold the sensitive-information permission."
        action={
          canEdit && !editing ? (
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              Edit
            </Button>
          ) : undefined
        }
      />
      <div className="p-5">
        {editing ? (
          <MiniForm
            action={changeContactDetailsAction}
            hidden={{ employmentId }}
            submitLabel="Save contact details"
            variant="primary"
            fullWidth
            onDone={() => setEditing(false)}
          >
            {(state) => (
              <>
                <ContactFields values={contact} errors={state.fieldErrors} prefix="contact" />
                <p className="text-muted text-xs">
                  Email is this person&rsquo;s sign-in and is changed with their invitation, not
                  here.
                </p>
              </>
            )}
          </MiniForm>
        ) : (
          <dl className="flex flex-col gap-3">
            {(
              [
                ['Email', contact.email],
                ['Phone', contact.phone],
                [
                  'Date of birth',
                  contact.dateOfBirth ? formatCalendarDate(contact.dateOfBirth) : null,
                ],
                ['Emergency contact', contact.emergencyContactName],
                ['Emergency phone', contact.emergencyContactPhone],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="flex flex-wrap justify-between gap-2">
                <dt className="text-muted text-sm">{label}</dt>
                <dd className="text-ink text-sm font-medium">{value ?? 'Not recorded'}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </Card>
  )
}
