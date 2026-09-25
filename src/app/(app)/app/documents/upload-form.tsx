'use client'

import { uploadDocumentAction } from '@/modules/documents/actions'
import { CATEGORY_LABELS, DOCUMENT_CATEGORIES } from '@/modules/documents/service'
import { Field, Input, Select, Textarea } from '@/ui/primitives'
import { MiniForm } from '@/ui/patterns/mini-form'

/** Upload one file, and say who it is for. */
export function UploadForm({ locations }: { locations: { id: string; name: string }[] }) {
  return (
    <MiniForm
      action={uploadDocumentAction}
      hidden={{}}
      submitLabel="Add document"
      variant="primary"
      fullWidth
    >
      {(state) => (
        <>
          <Field id="doc-file" label="File" error={state.fieldErrors?.file?.[0]}>
            {(p) => (
              <Input
                {...p}
                name="file"
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.txt,.csv,.docx,.xlsx"
                className="file:text-ink file:bg-tile file:mr-3 file:rounded-full file:border-0 file:px-3 file:py-1.5 file:text-sm file:font-medium"
              />
            )}
          </Field>
          <Field
            id="doc-title"
            label="Name"
            hint="What people would call it. Blank uses the file name."
            error={state.fieldErrors?.title?.[0]}
          >
            {(p) => <Input {...p} name="title" placeholder="Employee handbook" maxLength={160} />}
          </Field>
          <Field id="doc-description" label="What it is" hint="Optional, one line.">
            {(p) => <Textarea {...p} name="description" rows={2} maxLength={400} />}
          </Field>
          <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
            <Field id="doc-category" label="Category">
              {(p) => (
                <Select {...p} name="category" defaultValue="policy">
                  {DOCUMENT_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {CATEGORY_LABELS[category]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field id="doc-visibility" label="Who can open it">
              {(p) => (
                <Select {...p} name="visibility" defaultValue="everyone">
                  <option value="everyone">Everyone</option>
                  <option value="managers">Managers only</option>
                </Select>
              )}
            </Field>
          </div>
          {locations.length > 1 ? (
            <Field id="doc-location" label="Where it applies">
              {(p) => (
                <Select {...p} name="locationId" defaultValue="">
                  <option value="">The whole organization</option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
        </>
      )}
    </MiniForm>
  )
}
