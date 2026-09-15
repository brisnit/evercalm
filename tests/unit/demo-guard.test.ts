import { describe, expect, it } from 'vitest'
import {
  DEMO_DATABASE_MARKER,
  PRODUCTION_DATABASE_MARKER,
  assertDemoConfiguration,
  assertDemoMarker,
} from '@/server/db/demo-guard'

/** The stakeholder-demo reset must refuse anything that is not the demo database. */

const host = 'ep-demo-123.us-east-1.aws.neon.tech'
const url = (h: string) => {
  // secret-scan-allow: placeholder credentials assembled for the guard to parse
  return `postgres://role:placeholder@${h}/evercalm_demo?sslmode=require`
}

describe('stakeholder demo guard', () => {
  it('accepts only the configured demo host in the demo environment', () => {
    expect(() =>
      assertDemoConfiguration({
        environment: 'stakeholder-demo',
        configuredHost: host,
        connectionString: url(host),
      }),
    ).not.toThrow()
    // Neon's pooled host is the same database.
    expect(() =>
      assertDemoConfiguration({
        environment: 'stakeholder-demo',
        configuredHost: host,
        connectionString: url('ep-demo-123-pooler.us-east-1.aws.neon.tech'),
      }),
    ).not.toThrow()
  })

  it('refuses without the environment, without a configured host, or on another host', () => {
    expect(() =>
      assertDemoConfiguration({
        environment: undefined,
        configuredHost: host,
        connectionString: url(host),
      }),
    ).toThrow(/EVERCALM_ENVIRONMENT/)
    expect(() =>
      assertDemoConfiguration({
        environment: 'production',
        configuredHost: host,
        connectionString: url(host),
      }),
    ).toThrow(/EVERCALM_ENVIRONMENT/)
    expect(() =>
      assertDemoConfiguration({
        environment: 'stakeholder-demo',
        configuredHost: undefined,
        connectionString: url(host),
      }),
    ).toThrow(/DEMO_DATABASE_HOST/)
    expect(() =>
      assertDemoConfiguration({
        environment: 'stakeholder-demo',
        configuredHost: host,
        connectionString: url('ep-customer-999.us-east-1.aws.neon.tech'),
      }),
    ).toThrow(/not DEMO_DATABASE_HOST/)
    expect(() =>
      assertDemoConfiguration({
        environment: 'stakeholder-demo',
        configuredHost: host,
        connectionString: 'not a url',
      }),
    ).toThrow(/not a valid URL/)
  })

  it('requires the demo marker on the database and always refuses production', () => {
    expect(() => assertDemoMarker(DEMO_DATABASE_MARKER)).not.toThrow()
    expect(() => assertDemoMarker(null)).toThrow(/not marked as the stakeholder demo/)
    expect(() => assertDemoMarker('')).toThrow(/not marked/)
    expect(() => assertDemoMarker(PRODUCTION_DATABASE_MARKER)).toThrow(/marked as production/)
    expect(() => assertDemoMarker(`${DEMO_DATABASE_MARKER} ${PRODUCTION_DATABASE_MARKER}`)).toThrow(
      /marked as production/,
    )
  })
})
