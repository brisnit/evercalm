import { expect, test } from '@playwright/test'
import { expectNoConsoleErrors, trackConsoleErrors } from './helpers'

/**
 * The public site.
 *
 * The key assertion is the second one: every link in the header and footer
 * must reach something real. "No button suggests functionality that does not
 * exist" is part of the definition of done, and the navigation is now the
 * homepage's own table of contents, so an anchor has to resolve to a section
 * that is actually on the page - a `#platform` that matches nothing is the
 * same broken promise as a 404.
 */
test('the home page renders and offers real calls to action', async ({ page }) => {
  const errors = trackConsoleErrors(page)
  await page.goto('/')

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Everyone walks')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('What’s next.')
  // No self-service signup exists yet, so no call to action may suggest one.
  await expect(page.getByRole('link', { name: 'Ask about a pilot' }).first()).toHaveAttribute(
    'href',
    '/contact',
  )
  await expect(page.getByRole('link', { name: /start free|sign up|free trial/i })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Book a 20-minute walkthrough' })).toBeVisible()

  expectNoConsoleErrors(errors)
})

/*
 * REGRESSION: the hero's floating phone once covered the right edge of the
 * description, because it was positioned past the left edge of its own column.
 * The illustration is now a film, and the rule is the same: it is measured at
 * every width the page is designed for, so this fails whatever the cause - a
 * margin, a breakpoint, a font change.
 */
const HERO_WIDTHS = [1920, 1440, 1280, 1024, 768, 390, 360]

for (const width of HERO_WIDTHS) {
  test(`the hero film never covers its text at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    await expect(page.getByTestId('hero-video')).toBeVisible()

    const layout = await page.evaluate(() => {
      const box = (id: string) => {
        const el = document.querySelector(`[data-testid="${id}"]`)
        if (!el) throw new Error(`missing ${id}`)
        const r = el.getBoundingClientRect()
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
      }
      const headline = document.querySelector('[data-testid="hero-headline"]')!
      const range = document.createRange()
      range.selectNodeContents(headline)
      const description = document.querySelector<HTMLElement>('[data-testid="hero-description"]')!
      return {
        viewport: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        copy: box('hero-copy'),
        text: {
          headline: box('hero-headline'),
          description: box('hero-description'),
          actions: box('hero-actions'),
          'supporting copy': box('hero-proof'),
        },
        mock: box('hero-mock'),
        art: { film: box('hero-video') },
        headlineRight: Math.max(...Array.from(range.getClientRects()).map((r) => r.right)),
        descriptionFontSize: parseFloat(getComputedStyle(description).fontSize),
        descriptionClipped: description.scrollWidth > description.clientWidth + 1,
      }
    })

    type Box = { left: number; top: number; right: number; bottom: number }
    const intersects = (a: Box, b: Box) =>
      a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
    const inside = (inner: Box, outer: Box) =>
      inner.left >= outer.left - 1 &&
      inner.right <= outer.right + 1 &&
      inner.top >= outer.top - 1 &&
      inner.bottom <= outer.bottom + 1

    // The film touches no piece of text.
    for (const [artName, art] of Object.entries(layout.art)) {
      for (const [textName, text] of Object.entries(layout.text)) {
        expect(intersects(art, text), `${artName} overlaps the ${textName}`).toBe(false)
      }
      // ...and each stays inside its own column, and on screen.
      expect(inside(art, layout.mock), `${artName} leaves its column`).toBe(true)
      expect(art.left, `${artName} is cut off at the left`).toBeGreaterThanOrEqual(0)
      expect(art.right, `${artName} is cut off at the right`).toBeLessThanOrEqual(layout.viewport)
    }
    expect(intersects(layout.mock, layout.copy), 'the film column overlaps the text column').toBe(
      false,
    )

    // The text keeps its own boundary and stays readable.
    expect(layout.headlineRight, 'the headline runs out of its column').toBeLessThanOrEqual(
      layout.copy.right + 1,
    )
    expect(layout.descriptionClipped, 'the description is clipped').toBe(false)
    expect(layout.descriptionFontSize).toBeGreaterThanOrEqual(16)

    expect(layout.scrollWidth, 'the page scrolls sideways').toBeLessThanOrEqual(layout.viewport)
  })
}

test('the hero film is held back for anyone who prefers reduced motion', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' })
  const page = await context.newPage()
  await page.goto('/')
  await expect(page.getByTestId('hero-video')).toBeVisible()
  // The poster still paints; no video element is ever created, so nothing is
  // fetched and nothing moves.
  await page.waitForTimeout(2_500)
  await expect(page.locator('[data-testid="hero-video"] video')).toHaveCount(0)
  await expect(page.locator('[data-testid="hero-video"] img')).toHaveCount(1)
  await context.close()
})

test('the hero film plays without motion preferences, and carries no sound', async ({ page }) => {
  await page.goto('/')
  const video = page.locator('[data-testid="hero-video"] video')
  await expect(video).toHaveCount(1, { timeout: 15_000 })
  const state = await video.evaluate(async (v: HTMLVideoElement) => {
    await new Promise((r) => setTimeout(r, 1_500))
    return { muted: v.muted, loop: v.loop, paused: v.paused, src: v.currentSrc }
  })
  expect(state.muted, 'the hero film must never make noise').toBe(true)
  expect(state.loop).toBe(true)
  expect(state.src).toMatch(/evercalm-hero-(480|960)\.mp4$/)
})

test('every navigation link reaches a page that exists', async ({ page }) => {
  await page.goto('/')

  // Read from the DOM rather than from what is visible: the header links
  // collapse behind a breakpoint on a phone, and they still have to be real.
  const hrefs = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLAnchorElement>('header a[href], footer a[href]'))
      .map((a) => a.getAttribute('href'))
      .filter((h): h is string => !!h)
      .filter((h, i, all) => all.indexOf(h) === i),
  )
  expect(hrefs.length).toBeGreaterThanOrEqual(8)

  const anchors = hrefs.filter((h) => h.includes('#'))
  const pages = hrefs.filter((h) => !h.includes('#'))
  expect(anchors.length, 'the section navigation should be present').toBeGreaterThan(0)

  for (const href of anchors) {
    const id = href.slice(href.indexOf('#') + 1)
    await expect(page.locator(`#${id}`), `${href} points at no section`).toHaveCount(1)
  }

  for (const href of pages) {
    const response = await page.goto(href)
    expect(response?.status(), `${href} did not return 200`).toBe(200)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  }
})

test('the industry templates can be switched', async ({ page }) => {
  await page.goto('/#industries')

  const restaurants = page.getByRole('tab', { name: 'Restaurants' })
  const salons = page.getByRole('tab', { name: 'Salons & spas' })

  await expect(restaurants).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('heading', { name: 'Restaurants & bars' })).toBeVisible()

  await salons.click()
  await expect(salons).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('heading', { name: 'Salons & spas' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Restaurants & bars' })).toBeHidden()
})

test('the security page states what is NOT in place', async ({ page }) => {
  await page.goto('/security')
  await expect(page.getByRole('heading', { name: 'Not yet in place' })).toBeVisible()
  await expect(page.getByText('SOC 2')).toBeVisible()
})
