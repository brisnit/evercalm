/**
 * Reading form fields safely.
 *
 * `FormData.get()` returns `string | File | null`. Coercing that with
 * `String()` turns an uploaded file into "[object File]", which would sail
 * past validation as a plausible-looking value. These helpers return a string
 * only when the field actually is one.
 */

export function readString(formData: FormData, key: string, fallback = ''): string {
  const value = formData.get(key)
  return typeof value === 'string' ? value : fallback
}

export function readOptionalString(formData: FormData, key: string): string | undefined {
  const value = formData.get(key)
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
