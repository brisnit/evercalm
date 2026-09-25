'use client'

import { useRouter } from 'next/navigation'
import { Field, Select } from '@/ui/primitives'

/** Which site's week you are looking at. Navigates on change, no submit button. */
export function LocationPicker({
  locations,
  current,
  basePath,
  extra = {},
}: {
  locations: { id: string; name: string }[]
  current: string
  basePath: string
  extra?: Record<string, string>
}) {
  const router = useRouter()
  return (
    <Field id="location" label="Location">
      {(p) => (
        <Select
          {...p}
          value={current}
          onChange={(event) => {
            const query = new URLSearchParams({ ...extra, location: event.target.value })
            router.push(`${basePath}?${query.toString()}`)
          }}
          className="max-w-xs"
        >
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </Select>
      )}
    </Field>
  )
}
