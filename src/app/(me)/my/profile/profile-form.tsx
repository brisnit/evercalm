'use client'

import { changeContactDetailsAction } from '@/modules/people/actions'
import { ContactFields } from '@/ui/patterns/contact-fields'
import { MiniForm } from '@/ui/patterns/mini-form'
import { NoticeProvider } from '@/ui/patterns/notice-provider'

/** The employee's own contact details. The server checks it really is them. */
export function ProfileForm({
  employmentId,
  contact,
  email,
}: {
  employmentId: string
  contact: {
    phone: string | null
    dateOfBirth: string | null
    emergencyContactName: string | null
    emergencyContactPhone: string | null
  }
  email: string | null
}) {
  return (
    <NoticeProvider>
      <MiniForm
        action={changeContactDetailsAction}
        hidden={{ employmentId }}
        submitLabel="Save your details"
        variant="primary"
        fullWidth
      >
        {(state) => (
          <>
            <ContactFields values={contact} errors={state.fieldErrors} prefix="me" />
            <p className="text-muted text-xs">
              {email
                ? `You sign in with ${email}. Ask your manager to change that.`
                : 'Ask your manager to change your sign-in address.'}
            </p>
          </>
        )}
      </MiniForm>
    </NoticeProvider>
  )
}
