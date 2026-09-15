'use client'

import { replyToCaseAction } from '@/modules/support/actions'
import { MiniForm } from '@/ui/patterns/mini-form'
import { NoticeProvider } from '@/ui/patterns/notice-provider'
import { Field } from '@/ui/primitives'
import { TEXTAREA_CLASS } from '../../training/_components/styles'

export function CaseReply({ caseId, reopen }: { caseId: string; reopen: boolean }) {
  return (
    <NoticeProvider>
      <MiniForm
        action={replyToCaseAction}
        hidden={{ caseId }}
        submitLabel={reopen ? 'Reopen with this update' : 'Send update'}
        variant="primary"
      >
        {(state) => (
          <Field id="case-body" label="Your update" required error={state.fieldErrors?.body?.[0]}>
            {(p) => (
              <textarea
                {...p}
                name="body"
                rows={4}
                maxLength={5000}
                required
                className={TEXTAREA_CLASS}
              />
            )}
          </Field>
        )}
      </MiniForm>
    </NoticeProvider>
  )
}
