import { describe, expect, it } from 'vitest'
import { assertDevelopmentDatabase } from '@/lib/dev-only'

/**
 * The guard on the destructive CLI tools.
 *
 * `db:refresh` truncates every table and `db:seed` creates accounts whose
 * password is a constant in this repository. Both are one pasted connection
 * string away from doing that to somebody's real data.
 */

/** A parseable URL for a host, with placeholder credentials. */
function urlFor(host: string): string {
  // secret-scan-allow: placeholder credentials assembled for the guard to parse
  return `postgres://user:placeholder@${host}:5432/evercalm`
}

describe('assertDevelopmentDatabase', () => {
  it('allows a local database', () => {
    for (const host of ['localhost', '127.0.0.1', '0.0.0.0']) {
      expect(() => assertDevelopmentDatabase('seed', urlFor(host)), host).not.toThrow()
    }
  })

  it('refuses any host that is not loopback', () => {
    for (const host of [
      'ep-cool-name-123.us-east-2.aws.neon.tech',
      'db.internal',
      'evercalm.example.com',
    ]) {
      expect(() => assertDevelopmentDatabase('seed', urlFor(host)), host).toThrow(
        /not a local database/,
      )
    }
  })

  it('refuses in production even when the database is local', () => {
    const env = process.env as Record<string, string | undefined>
    const previous = env.NODE_ENV
    env.NODE_ENV = 'production'
    try {
      expect(() => assertDevelopmentDatabase('truncate', urlFor('localhost'))).toThrow(
        /NODE_ENV is production/,
      )
    } finally {
      env.NODE_ENV = previous
    }
  })

  it('refuses a URL it cannot parse rather than guessing', () => {
    expect(() => assertDevelopmentDatabase('seed', 'not a url')).toThrow(/could not be parsed/)
  })

  it('names the operation it refused, so the message is actionable', () => {
    expect(() => assertDevelopmentDatabase('truncate and reseed', urlFor('prod.db'))).toThrow(
      /Refusing to truncate and reseed/,
    )
  })
})
