import { afterEach, describe, expect, it, vi } from 'vitest'
import { getEnv, resetEnvCache } from '@/lib/env'
import { manualProvider, mockProvider, signMockPayload } from '@/modules/billing/provider'
import { poolSettings } from '@/server/db/client'
import { parseProvisionSpec } from '@/server/db/provision'
import { PermanentEmailError } from '@/server/email/provider'
import { ResendEmailProvider } from '@/server/email/resend-provider'
import { bearerTokenMatches, handleCronWorker } from '@/server/jobs/cron'
import type { TickReport } from '@/server/jobs/worker'

/** The pieces a production pilot on a serverless host depends on. */

const BASE = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://app@localhost:5432/evercalm',
  BETTER_AUTH_SECRET: 'x'.repeat(40),
  EMAIL_PROVIDER: 'console',
  BILLING_PROVIDER: 'mock',
} as const

function envWith(values: Record<string, string | undefined>) {
  vi.unstubAllEnvs()
  resetEnvCache()
  for (const [key, value] of Object.entries({ ...BASE, ...values })) vi.stubEnv(key, value)
  return () => {
    resetEnvCache()
    return getEnv()
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
  resetEnvCache()
})

describe('environment', () => {
  it('allows the manual pilot provider in production, and still refuses the mock', () => {
    const production = {
      NODE_ENV: 'production',
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 're_' + 'k'.repeat(30),
      EMAIL_FROM: 'EverCalm <notifications@mail.evercalm-pilot.com>',
    }
    expect(envWith({ ...production, BILLING_PROVIDER: 'manual' })().BILLING_PROVIDER).toBe('manual')
    expect(envWith({ ...production, BILLING_PROVIDER: 'mock' })).toThrow(/BILLING_PROVIDER/)
    expect(envWith({ ...production, BILLING_PROVIDER: 'stripe' })).toThrow(/BILLING_PROVIDER/)
  })

  it('requires an API key and a real sender for Resend', () => {
    expect(envWith({ EMAIL_PROVIDER: 'resend', EMAIL_FROM: 'EverCalm <a@b.com>' })).toThrow(
      /RESEND_API_KEY/,
    )
    for (const from of [
      'EverCalm <no-reply@example.invalid>',
      'someone@example.test',
      'not an address',
    ]) {
      expect(
        envWith({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_x', EMAIL_FROM: from }),
      ).toThrow(/EMAIL_FROM/)
    }
  })

  it('requires a long cron secret and a sane pool size when set', () => {
    expect(envWith({ CRON_SECRET: 'short' })).toThrow(/CRON_SECRET/)
    expect(envWith({ DATABASE_POOL_MAX: '0' })).toThrow(/DATABASE_POOL_MAX/)
    expect(envWith({ DATABASE_POOL_MAX: '4' })().DATABASE_POOL_MAX).toBe(4)
  })
})

describe('stakeholder demo environment', () => {
  const production = {
    NODE_ENV: 'production',
    BILLING_PROVIDER: 'manual',
  }

  it('allows email to be switched off explicitly in production, and still refuses the console stub', () => {
    expect(envWith({ ...production, EMAIL_PROVIDER: 'disabled' })().EMAIL_PROVIDER).toBe('disabled')
    expect(envWith({ ...production, EMAIL_PROVIDER: 'console' })).toThrow(/EMAIL_PROVIDER/)
  })

  it('recognises only the stakeholder-demo environment label', () => {
    expect(envWith({ EVERCALM_ENVIRONMENT: 'stakeholder-demo' })().EVERCALM_ENVIRONMENT).toBe(
      'stakeholder-demo',
    )
    expect(envWith({})().EVERCALM_ENVIRONMENT).toBeUndefined()
    expect(envWith({ EVERCALM_ENVIRONMENT: 'production' })).toThrow(/EVERCALM_ENVIRONMENT/)
  })
})

describe('database pool', () => {
  it('stays small and lets idle serverless instances go', () => {
    expect(poolSettings(undefined, true)).toEqual({
      max: 3,
      idleTimeoutMillis: 5_000,
      allowExitOnIdle: true,
    })
    expect(poolSettings(undefined, false).max).toBe(10)
    expect(poolSettings(2, false).max).toBe(2)
  })
})

describe('Resend adapter', () => {
  // Not a real credential: assembled so nothing looks like one.
  const fakeKey = ['re', 'unit', 'fake'].join('_')
  const message = {
    to: 'sam@harborvine.test',
    subject: 'Shift reminder',
    text: 'Your shift starts at 5pm.',
    idempotencyKey: 'notification-1',
  }
  const respond = (status: number, body: unknown) =>
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })))

  it('sends with the key, the verified sender and an idempotency key', async () => {
    const fetch = respond(200, { id: 'email_123' })
    const provider = new ResendEmailProvider({
      apiKey: fakeKey,
      from: 'EverCalm <notifications@mail.evercalm-pilot.com>',
      fetch,
    })
    await expect(provider.send(message)).resolves.toEqual({
      id: 'email_123',
      delivered: true,
      provider: 'resend',
    })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.resend.com/emails')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${fakeKey}`)
    expect(headers['Idempotency-Key']).toBe('notification-1')
    expect(JSON.parse(init.body as string)).toMatchObject({
      from: 'EverCalm <notifications@mail.evercalm-pilot.com>',
      to: ['sam@harborvine.test'],
      subject: 'Shift reminder',
    })
  })

  it('treats a refusal as permanent and never repeats the recipient in the error', async () => {
    const provider = new ResendEmailProvider({
      apiKey: 'k',
      from: 'a@b.com',
      fetch: respond(422, { name: 'validation_error', message: 'sam@harborvine.test is invalid' }),
    })
    const error = await provider.send(message).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PermanentEmailError)
    expect(String(error)).toContain('validation_error')
    expect(String(error)).not.toContain('harborvine')
  })

  it('treats rate limiting, server errors and network failures as transient', async () => {
    for (const fetch of [
      respond(429, { name: 'rate_limit_exceeded' }),
      respond(503, {}),
      vi.fn(() => Promise.reject(new TypeError('fetch failed'))),
    ]) {
      const provider = new ResendEmailProvider({ apiKey: 'k', from: 'a@b.com', fetch })
      const error = await provider.send(message).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(Error)
      expect(error).not.toBeInstanceOf(PermanentEmailError)
    }
  })

  it('gives up on a request that hangs', async () => {
    const fetch = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          ),
        ),
    )
    const provider = new ResendEmailProvider({ apiKey: 'k', from: 'a@b.com', timeoutMs: 10, fetch })
    await expect(provider.send(message)).rejects.toThrow('did not respond in time')
  })
})

describe('scheduled worker endpoint', () => {
  const signingValue = 's'.repeat(48)
  const report: TickReport = {
    startedAt: new Date(1_000),
    finishedAt: new Date(1_250),
    organizations: 2,
    published: 1,
    expiredBeforePublish: 0,
    scheduleFailures: 0,
    expired: 0,
    reminded: 1,
    shiftReminders: 2,
    billingChanges: 0,
    deferredOrganizations: 1,
    sent: 4,
    retrying: 0,
    failed: 0,
    leaseLost: 0,
    errors: [
      { organizationId: '00000000-0000-4000-8000-000000000001', step: 'publish', message: 'x' },
    ],
  }

  it('accepts only the exact bearer token', () => {
    expect(bearerTokenMatches(`Bearer ${signingValue}`, signingValue)).toBe(true)
    for (const header of [
      null,
      '',
      signingValue,
      `bearer ${signingValue}`,
      `Basic ${signingValue}`,
      `Bearer ${signingValue}x`,
      `Bearer ${signingValue.slice(1)}`,
      'Bearer ',
    ]) {
      expect(bearerTokenMatches(header, signingValue), String(header)).toBe(false)
    }
    // No secret configured: closed to everyone.
    expect(bearerTokenMatches('Bearer ', undefined)).toBe(false)
    expect(bearerTokenMatches('Bearer undefined', undefined)).toBe(false)
  })

  it('answers 404 without running anything, and reports counts only', async () => {
    const runTick = vi.fn(() => Promise.resolve(report))
    expect(await handleCronWorker('Bearer wrong', { secret: signingValue, runTick })).toEqual({
      status: 404,
    })
    expect(
      await handleCronWorker(`Bearer ${signingValue}`, { secret: undefined, runTick }),
    ).toEqual({
      status: 404,
    })
    expect(runTick).not.toHaveBeenCalled()

    const outcome = await handleCronWorker(`Bearer ${signingValue}`, {
      secret: signingValue,
      runTick,
    })
    expect(outcome).toEqual({
      status: 200,
      body: {
        ok: false,
        organizations: 2,
        deferred: 1,
        published: 1,
        reminded: 3,
        billingChanges: 0,
        sent: 4,
        retrying: 0,
        failed: 0,
        errors: 1,
        durationMs: 250,
      },
    })
    expect(JSON.stringify(outcome)).not.toContain('00000000-0000-4000')
  })
})

describe('manual pilot billing provider', () => {
  it('charges nothing, accepts no webhooks, offers no simulations and no owner self-service', () => {
    const provider = manualProvider()
    expect(provider).toMatchObject({
      name: 'manual',
      live: false,
      simulationsEnabled: false,
      ownerSelfService: false,
    })
    const body = JSON.stringify({ id: 'mock_evt_12345678', type: 'payment_failed' })
    expect(provider.verifyWebhook(body, signMockPayload(body, 'a'.repeat(40)))).toBeNull()
    expect(mockProvider({ secret: undefined, production: false }).ownerSelfService).toBe(true)
  })
})

describe('provisioning file', () => {
  const valid = {
    organization: {
      name: 'Example Kitchen',
      slug: 'example-kitchen',
      industry: 'restaurant',
      timezone: 'America/Los_Angeles',
    },
    locations: [{ name: 'Main Street', timezone: 'America/Los_Angeles' }],
    owner: { displayName: 'Owner Name', email: 'Owner@Example.com' },
  }

  it('accepts a complete file and normalizes the owner address', () => {
    const parsed = parseProvisionSpec(valid)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.spec.owner.email).toBe('owner@example.com')
  })

  it('lists every problem at once', () => {
    const parsed = parseProvisionSpec({
      organization: { name: '', slug: 'Bad Slug', industry: 'Restaurant!', timezone: 'Mars/Base' },
      locations: [
        { name: 'A', timezone: 'UTC' },
        { name: 'a', timezone: 'Nowhere' },
      ],
      owner: { displayName: '', email: 'nobody' },
    })
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.errors.join('\n')).toMatch(/organization.name/)
      expect(parsed.errors.join('\n')).toMatch(/organization.slug/)
      expect(parsed.errors.join('\n')).toMatch(/organization.industry/)
      expect(parsed.errors.join('\n')).toMatch(/organization.timezone/)
      expect(parsed.errors.join('\n')).toMatch(/repeated/)
      expect(parsed.errors.join('\n')).toMatch(/locations\[1\].timezone/)
      expect(parsed.errors.join('\n')).toMatch(/owner.displayName/)
      expect(parsed.errors.join('\n')).toMatch(/owner.email/)
    }
    expect(parseProvisionSpec({ ...valid, locations: [] }).ok).toBe(false)
    expect(parseProvisionSpec(null).ok).toBe(false)
  })

  it('has no field for a password', () => {
    const parsed = parseProvisionSpec({ ...valid, owner: { ...valid.owner, password: 'hunter2' } })
    expect(parsed.ok && JSON.stringify(parsed.spec)).not.toContain('hunter2')
  })
})
