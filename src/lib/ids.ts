import { uuidv7 } from 'uuidv7'

/**
 * UUIDv7 identifiers: time-ordered so they index well, and opaque so they
 * never leak a tenant's record counts the way sequential integers do.
 */
export function newId(): string {
  return uuidv7()
}
