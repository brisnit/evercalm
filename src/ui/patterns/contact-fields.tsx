import { Field, Input } from '@/ui/primitives'

/**
 * The contact details a person or their manager may change.
 *
 * Email is deliberately absent: it is the person's sign-in, so changing it is
 * an identity change rather than a detail edit, and it belongs with the work
 * that handles invitations and sessions.
 */
export function ContactFields({
  values,
  errors,
  prefix,
}: {
  values: {
    phone: string | null
    emergencyContactName: string | null
    emergencyContactPhone: string | null
    dateOfBirth: string | null
  }
  errors?: Record<string, string[]>
  prefix: string
}) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
        <Field id={`${prefix}-phone`} label="Phone" error={errors?.phone?.[0]}>
          {(p) => (
            <Input
              {...p}
              name="phone"
              type="tel"
              autoComplete="tel"
              defaultValue={values.phone ?? ''}
              placeholder="(555) 555-5555"
            />
          )}
        </Field>
        <Field
          id={`${prefix}-dob`}
          label="Date of birth"
          hint="Optional."
          error={errors?.dateOfBirth?.[0]}
        >
          {(p) => (
            <Input {...p} name="dateOfBirth" type="date" defaultValue={values.dateOfBirth ?? ''} />
          )}
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
        <Field
          id={`${prefix}-ice-name`}
          label="Emergency contact"
          error={errors?.emergencyContactName?.[0]}
        >
          {(p) => (
            <Input
              {...p}
              name="emergencyContactName"
              autoComplete="off"
              defaultValue={values.emergencyContactName ?? ''}
              placeholder="Who to call"
            />
          )}
        </Field>
        <Field
          id={`${prefix}-ice-phone`}
          label="Emergency phone"
          error={errors?.emergencyContactPhone?.[0]}
        >
          {(p) => (
            <Input
              {...p}
              name="emergencyContactPhone"
              type="tel"
              autoComplete="off"
              defaultValue={values.emergencyContactPhone ?? ''}
              placeholder="(555) 555-5555"
            />
          )}
        </Field>
      </div>
    </>
  )
}
