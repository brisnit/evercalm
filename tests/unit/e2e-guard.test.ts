import { describe, expect, it } from 'vitest'
import {
  assertE2eDatabase,
  assertE2eDatabaseName,
  assertE2eMarker,
  databaseNameOf,
  DEVELOPMENT_DATABASE_MARKER,
  E2E_DATABASE_MARKER,
  E2E_DATABASE_NAME,
  E2eGuardError,
} from '@/server/db/e2e-guard'
import { DEMO_DATABASE_MARKER, PRODUCTION_DATABASE_MARKER } from '@/server/db/demo-guard'

/**
 * The browser suite truncates and reseeds its database, so these are the
 * checks that stand between it and somebody's real data. A test run reseeded a
 * developer's own database once; each case below is one way that happens.
 */

const url = (database: string, host = '127.0.0.1') =>
  // secret-scan-allow: placeholder credentials assembled for the guard to parse
  `postgres://evercalm_migrator:placeholder@${host}:55500/${database}`

describe('the browser-test database name', () => {
  it('refuses the development database', () => {
    expect(() => assertE2eDatabaseName('reseed', url('evercalm_dev'))).toThrow(E2eGuardError)
    expect(() => assertE2eDatabaseName('reseed', url('evercalm_dev'))).toThrow(
      /"evercalm_dev" is not the browser-test database/,
    )
  })

  it('refuses a hosted stakeholder-demo or production database', () => {
    for (const hosted of [
      url('evercalm_demo', 'ep-demo-123.us-east-1.aws.neon.tech'),
      url('evercalm', 'ep-prod-456.us-east-1.aws.neon.tech'),
      url('evercalm_production'),
    ]) {
      expect(() => assertE2eDatabaseName('reseed', hosted), hosted).toThrow(E2eGuardError)
    }
  })

  it('refuses a name that merely looks close enough', () => {
    for (const near of ['evercalm_e2e_old', 'evercalm_E2E', 'e2e', 'evercalm_dev_e2e']) {
      expect(() => assertE2eDatabaseName('reseed', url(near)), near).toThrow(E2eGuardError)
    }
  })

  it('refuses a missing or unparseable connection string', () => {
    expect(() => assertE2eDatabaseName('reseed', undefined)).toThrow(
      /no database connection string is set/,
    )
    expect(() => assertE2eDatabaseName('reseed', 'not-a-url')).toThrow(E2eGuardError)
    // secret-scan-allow: placeholder credentials assembled for the guard to parse
    const noDatabase = 'postgres://user:placeholder@127.0.0.1:55500/'
    expect(() => assertE2eDatabaseName('reseed', noDatabase)).toThrow(/names no database/)
  })

  it('accepts the browser-test database', () => {
    expect(() => assertE2eDatabaseName('reseed', url(E2E_DATABASE_NAME))).not.toThrow()
    expect(databaseNameOf('reseed', url(E2E_DATABASE_NAME))).toBe('evercalm_e2e')
  })
})

describe("the browser-test database's own marker", () => {
  it('refuses the development, stakeholder-demo and production markers by name', () => {
    const cases: [string, RegExp][] = [
      [DEVELOPMENT_DATABASE_MARKER, /marked as a development database/],
      [DEMO_DATABASE_MARKER, /marked as the stakeholder demo/],
      [PRODUCTION_DATABASE_MARKER, /marked as production/],
    ]
    for (const [marker, message] of cases) {
      expect(() => assertE2eMarker('reseed', marker), marker).toThrow(message)
      // Also when the marker sits inside a longer description.
      expect(() => assertE2eMarker('reseed', `EverCalm ${marker} - do not touch`)).toThrow(message)
    }
  })

  it('refuses a database with no marker at all', () => {
    for (const blank of [null, undefined, '', '   ']) {
      expect(() => assertE2eMarker('reseed', blank)).toThrow(/carries no marker/)
    }
  })

  it('refuses any other marker, naming what it found', () => {
    expect(() => assertE2eMarker('reseed', 'evercalm:staging')).toThrow(
      /marked "evercalm:staging", not "evercalm:e2e"/,
    )
  })

  it('accepts the e2e marker', () => {
    expect(() => assertE2eMarker('reseed', E2E_DATABASE_MARKER)).not.toThrow()
    expect(() => assertE2eMarker('reseed', ` ${E2E_DATABASE_MARKER} `)).not.toThrow()
  })
})

describe('both checks together', () => {
  it('needs the name AND the marker, and never reads a marker it has already refused', async () => {
    let reads = 0
    const marker = (): Promise<string> => {
      reads += 1
      return Promise.resolve(E2E_DATABASE_MARKER)
    }

    // Right marker, wrong database: refused without connecting.
    await expect(assertE2eDatabase('reseed', url('evercalm_dev'), marker)).rejects.toThrow(
      E2eGuardError,
    )
    expect(reads).toBe(0)

    // Right database, wrong marker: refused after reading it.
    await expect(
      assertE2eDatabase('reseed', url(E2E_DATABASE_NAME), () =>
        Promise.resolve('evercalm:development'),
      ),
    ).rejects.toThrow(/marked as a development database/)

    // Both right.
    await expect(
      assertE2eDatabase('reseed', url(E2E_DATABASE_NAME), marker),
    ).resolves.toBeUndefined()
    expect(reads).toBe(1)
  })
})
