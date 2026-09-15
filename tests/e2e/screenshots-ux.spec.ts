import { mkdirSync, writeFileSync } from 'node:fs'
import AxeBuilder from '@axe-core/playwright'
import { devices, expect, test, type Browser, type Page } from '@playwright/test'
import { PEOPLE, SEED_PASSWORD, signIn, trackConsoleErrors } from './helpers'

/**
 * UX REVIEW CAPTURE - not an assertion suite.
 *
 * Walks the whole product as each review persona, at desktop and phone width
 * (and tablet on request), saving a full-page screenshot and measurements of
 * every screen: sideways overflow, axe WCAG 2.2 AA violations, headings, small
 * touch targets, visible primary actions, console errors and load time.
 *
 *   CAPTURE_SCREENSHOTS=1 UX_LABEL=before npx playwright test screenshots-ux --project=desktop
 *   UX_VIEWPORTS=desktop,tablet,phone UX_ROLES=dana,ava ...
 *
 * Output goes to docs/screenshots/ux/<label>/ (gitignored).
 */

const LABEL = process.env.UX_LABEL ?? 'before'
const OUT = `docs/screenshots/ux/${LABEL}`
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 } },
  tablet: { viewport: { width: 834, height: 1112 }, hasTouch: true },
  phone: { ...devices['iPhone 14'] },
} as const
type ViewportKey = keyof typeof VIEWPORTS

/** A fixed path, or the first link on `from` whose href matches `href`. */
type Route = string | { name: string; from: string; href: RegExp }

const ADMIN_FULL: Route[] = [
  '/app',
  '/app/setup',
  '/app/people',
  { name: 'person', from: '/app/people', href: /^\/app\/people\/[0-9a-f-]{36}$/ },
  '/app/people/invite',
  '/app/people/invitations',
  '/app/people/import',
  '/app/onboarding',
  '/app/onboarding/templates',
  {
    name: 'onboarding-template',
    from: '/app/onboarding/templates',
    href: /^\/app\/onboarding\/templates\/[0-9a-f-]{36}$/,
  },
  '/app/comms',
  '/app/comms/new',
  { name: 'announcement', from: '/app/comms', href: /^\/app\/comms\/[0-9a-f-]{36}$/ },
  '/app/schedule',
  { name: 'shift', from: '/app/schedule', href: /^\/app\/schedule\/shifts\/[0-9a-f-]{36}$/ },
  '/app/schedule/requests',
  '/app/schedule/availability',
  '/app/schedule/templates',
  '/app/training',
  '/app/training/courses/new',
  {
    name: 'course',
    from: '/app/training',
    href: /^\/app\/training\/courses\/[0-9a-f-]{36}$/,
  },
  '/app/training/progress',
  '/app/training/sign-offs',
  '/app/operations',
  '/app/operations/handoffs',
  '/app/operations/templates',
  '/app/reports',
  '/app/reports/people',
  '/app/reports/schedule',
  '/app/settings',
  '/app/settings/structure',
  '/app/settings/values',
  '/app/settings/audit',
  '/app/settings/billing',
  '/app/settings/status',
  '/app/support',
  '/app/support/new',
  { name: 'support-case', from: '/app/support', href: /^\/app\/support\/[0-9a-f-]{36}$/ },
]

const EMPLOYEE: Route[] = [
  '/my',
  '/my/onboarding',
  '/my/training',
  { name: 'training-assignment', from: '/my/training', href: /^\/my\/training\/[0-9a-f-]{36}$/ },
  '/my/inbox',
  { name: 'message', from: '/my/inbox', href: /^\/my\/inbox\/[0-9a-f-]{36}$/ },
  '/my/notifications',
  '/my/schedule',
  { name: 'shift-detail', from: '/my/schedule', href: /^\/my\/schedule\/shifts\/[0-9a-f-]{36}$/ },
  '/my/time-off',
  '/my/availability',
  '/my/shift',
]

const STAFF: Route[] = [
  '/platform',
  {
    name: 'organization',
    from: '/platform',
    href: /^\/platform\/organizations\/[0-9a-f-]{36}$/,
  },
  '/platform/support',
  {
    name: 'staff-case',
    from: '/platform/support',
    href: /^\/platform\/support\/[0-9a-f-]{36}$/,
  },
]

const PERSONAS: { key: string; email: string | null; staff?: boolean; routes: Route[] }[] = [
  { key: 'visitor', email: null, routes: ['/', '/pricing', '/security', '/contact', '/signin'] },
  { key: 'dana', email: PEOPLE.harborOwner.email, routes: [...ADMIN_FULL, '/my'] },
  {
    key: 'marcus',
    email: PEOPLE.harborGmRiverside.email,
    routes: [
      '/app',
      '/app/people',
      '/app/onboarding',
      '/app/comms',
      '/app/schedule',
      '/app/schedule/requests',
      '/app/training/progress',
      '/app/operations',
      '/app/operations/handoffs',
      '/app/reports',
      '/app/settings/audit',
      '/my',
    ],
  },
  { key: 'ava', email: PEOPLE.harborNewServer.email, routes: EMPLOYEE },
  { key: 'sam', email: PEOPLE.harborEmployee.email, routes: EMPLOYEE },
  {
    key: 'ana',
    email: PEOPLE.salonOwner.email,
    routes: [
      '/app',
      '/app/people',
      '/app/schedule',
      '/app/training',
      '/app/operations',
      '/app/reports',
      '/app/settings/billing',
      '/app/settings/status',
      '/app/support',
    ],
  },
  { key: 'elodie', email: PEOPLE.salonNewStylist.email, routes: EMPLOYEE },
  { key: 'morgan', email: 'morgan@evercalm.test', staff: true, routes: STAFF },
  { key: 'jamie', email: 'jamie@evercalm.test', staff: true, routes: STAFF },
]

async function signInAsStaff(page: Page, email: string) {
  await page.goto('/signin')
  await page.waitForFunction(() => {
    const el = document.querySelector('#email')
    return !!el && Object.keys(el).some((k) => k.startsWith('__react'))
  })
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(SEED_PASSWORD)
  await expect(page.getByLabel('Email')).toHaveValue(email)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/platform/, { timeout: 30_000 })
  await page.getByRole('main').waitFor()
}

async function resolve(page: Page, route: Route): Promise<{ name: string; path: string } | null> {
  if (typeof route === 'string') {
    return { name: route === '/' ? 'home' : route.slice(1).replace(/\//g, '-'), path: route }
  }
  await page.goto(route.from)
  const hrefs = await page
    .locator('a[href]')
    .evaluateAll((links) => links.map((l) => l.getAttribute('href') ?? ''))
  const path = hrefs.find((h) => route.href.test(h))
  return path ? { name: route.name, path } : null
}

async function measure(page: Page, phone: boolean) {
  return page.evaluate((isPhone) => {
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect()
      const s = getComputedStyle(el)
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
    }
    const interactive = [
      ...document.querySelectorAll(
        'a[href], button, input:not([type=hidden]), select, textarea, summary',
      ),
    ].filter(visible)
    const main = document.querySelector('main') ?? document.body
    const small = interactive
      .filter((el) => main.contains(el) || !isPhone)
      .map((el) => {
        const r = el.getBoundingClientRect()
        return { el, w: r.width, h: r.height }
      })
    const nav = performance.getEntriesByType('navigation')[0] as
      PerformanceNavigationTiming | undefined
    return {
      title: document.title,
      h1: [...document.querySelectorAll('h1')].map((h) => h.textContent?.trim() ?? ''),
      h2Count: document.querySelectorAll('h2').length,
      overflowPx: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      pageHeight: document.documentElement.scrollHeight,
      interactive: interactive.length,
      buttons: document.querySelectorAll('button').length,
      primaryButtons: [...document.querySelectorAll('button, a')].filter(
        (el) => visible(el) && /\bbg-violet-6/.test(el.className?.toString() ?? ''),
      ).length,
      cards: [...document.querySelectorAll('.rounded-card')].filter(visible).length,
      badges: [...document.querySelectorAll('[data-badge], .rounded-full')].filter(visible).length,
      targetsUnder24: small.filter((t) => t.h < 24 || t.w < 24).length,
      targetsUnder44: small.filter((t) => t.h < 44).length,
      smallTargetSamples: small
        .filter((t) => t.h < 24 || t.w < 24)
        .slice(0, 6)
        .map(
          (t) =>
            `${t.el.tagName.toLowerCase()} "${(t.el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(t.w)}x${Math.round(t.h)}`,
        ),
      emptyStates: document.querySelectorAll('[data-empty-state]').length,
      loadMs: nav ? Math.round(nav.duration) : null,
      words: (main.textContent ?? '').split(/\s+/).filter(Boolean).length,
      images: document.images.length,
    }
  }, phone)
}

async function walk(
  browser: Browser,
  persona: (typeof PERSONAS)[number],
  viewportKey: ViewportKey,
) {
  const context = await browser.newContext({
    ...VIEWPORTS[viewportKey],
    baseURL: 'http://localhost:3000',
  })
  const page = await context.newPage()
  const errors = trackConsoleErrors(page)
  const dir = `${OUT}/${viewportKey}`
  mkdirSync(dir, { recursive: true })
  if (persona.email) {
    if (persona.staff) await signInAsStaff(page, persona.email)
    else await signIn(page, persona.email)
  }
  const results: Record<string, unknown>[] = []
  for (const route of persona.routes) {
    const target = await resolve(page, route).catch(() => null)
    if (!target) {
      results.push({ route: typeof route === 'string' ? route : route.name, missing: true })
      continue
    }
    const before = errors.length
    const response = await page.goto(target.path, { waitUntil: 'load' })
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined)
    // Scroll the page through once, as a reader would, so anything revealed on
    // scroll has been revealed; then let entrance animations settle.
    await page.evaluate(async () => {
      const step = Math.max(200, Math.floor(window.innerHeight * 0.8))
      for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
        window.scrollTo(0, y)
        await new Promise((r) => setTimeout(r, 60))
      }
      window.scrollTo(0, 0)
    })
    await page.waitForTimeout(900)
    const metrics = await measure(page, viewportKey === 'phone')
    const axe = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
    const file = `${dir}/${persona.key}--${target.name}.png`
    await page.screenshot({ path: file, fullPage: true })
    results.push({
      persona: persona.key,
      viewport: viewportKey,
      name: target.name,
      path: target.path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id'),
      status: response?.status(),
      finalPath: new URL(page.url()).pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id'),
      screenshot: file,
      axe: axe.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
      consoleErrors: errors.slice(before).map((e) => e.split('\n')[0]),
      ...metrics,
    })
  }
  if (persona.key === 'visitor') {
    // Content must be complete and readable with motion switched off.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/', { waitUntil: 'load' })
    const hidden = await page.evaluate(
      () =>
        [...document.querySelectorAll('[data-reveal]')].filter((el) => {
          const style = getComputedStyle(el)
          return Number(style.opacity) < 1 || style.transform !== 'none'
        }).length,
    )
    await page.screenshot({ path: `${dir}/visitor--home-reduced-motion.png`, fullPage: true })
    results.push({
      persona: 'visitor',
      viewport: viewportKey,
      name: 'home-reduced-motion',
      hiddenRevealBlocks: hidden,
    })
  }
  writeFileSync(`${dir}/${persona.key}.json`, JSON.stringify(results, null, 2))
  await context.close()
}

const wantedViewports = (process.env.UX_VIEWPORTS ?? 'desktop,phone').split(',') as ViewportKey[]
const wantedRoles = process.env.UX_ROLES?.split(',')

test.describe('@screenshots ux review', () => {
  test.skip(!process.env.CAPTURE_SCREENSHOTS, 'Set CAPTURE_SCREENSHOTS=1 to capture')
  test.describe.configure({ timeout: 30 * 60_000 })

  for (const persona of PERSONAS.filter((p) => !wantedRoles || wantedRoles.includes(p.key))) {
    for (const viewportKey of wantedViewports) {
      test(`${persona.key} at ${viewportKey}`, async ({ browser }) => {
        await walk(browser, persona, viewportKey)
      })
    }
  }
})
