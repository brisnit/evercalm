/**
 * Is this string shaped like a UUID?
 *
 * Route parameters arrive as arbitrary text. Handing `/my/inbox/nonsense` to a
 * uuid column makes PostgreSQL raise 22P02, which surfaces as a 500 - the
 * wrong answer twice over: it is not a server fault, and an error page is a
 * different response from "no such thing", which is exactly the distinction
 * the 404-not-403 rule exists to avoid leaking.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID.test(value)
}
