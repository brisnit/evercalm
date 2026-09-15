import { expect, test, type Page } from '@playwright/test'
import { PEOPLE, signIn } from './helpers'

/**
 * Nothing may scroll sideways at phone width.
 *
 * A page whose content is wider than the screen is broken on a phone: content
 * is cut off, and the whole layout drifts as the reader scrolls. It is also
 * invisible in unit tests and easy to reintroduce - one grid item that refuses
 * to shrink is enough - so it is asserted rather than reviewed.
 *
 * The check reports the widest offending element, because "the page is 88px
 * too wide" on its own is a long hunt.
 */
async function expectNoHorizontalOverflow(page: Page, path: string) {
  const report = await page.evaluate(() => {
    const viewport = document.documentElement.clientWidth
    const offenders: string[] = []
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const rect = el.getBoundingClientRect()
      // Deliberately off-screen things (the skip link) are not overflow.
      if (rect.width === 0 || rect.right < 0) continue
      if (rect.right > viewport + 1) {
        offenders.push(
          `<${el.tagName.toLowerCase()} class="${el.className}"> right=${Math.round(rect.right)}`,
        )
      }
    }
    return {
      viewport,
      scrollWidth: document.documentElement.scrollWidth,
      widest: offenders.slice(0, 3),
    }
  })

  expect(
    report.scrollWidth,
    `${path} scrolls sideways at ${report.viewport}px. Widest: ${report.widest.join(' | ')}`,
  ).toBeLessThanOrEqual(report.viewport + 1)
}

test.use({ viewport: { width: 390, height: 844 } })

test('administration screens fit a phone screen', async ({ page }) => {
  await signIn(page, PEOPLE.harborOwner.email)
  for (const path of [
    '/app',
    '/app/setup',
    '/app/people',
    '/app/people/invite',
    '/app/people/invitations',
    '/app/people/import',
    '/app/onboarding',
    '/app/onboarding/templates',
    '/app/comms',
    '/app/comms/new',
    '/app/schedule',
    '/app/schedule/requests',
    '/app/schedule/availability',
    '/app/schedule/templates',
    '/app/settings',
    '/app/settings/structure',
    '/app/settings/values',
    '/app/settings/audit',
  ]) {
    await page.goto(path)
    await expectNoHorizontalOverflow(page, path)
  }
})

test('the template builder fits a phone screen', async ({ page }) => {
  await signIn(page, PEOPLE.harborHr.email)
  await page.goto('/app/onboarding/templates')
  await page.getByRole('link', { name: 'New Server Onboarding' }).click()
  await expect(page.getByRole('heading', { name: 'New Server Onboarding' })).toBeVisible()
  await expectNoHorizontalOverflow(page, '/app/onboarding/templates/[id]')

  await page.getByRole('link', { name: /^Preview/ }).click()
  await expect(page.getByRole('heading', { name: 'What a new hire sees' })).toBeVisible()
  await expectNoHorizontalOverflow(page, 'template preview')
})

test('an employee profile fits a phone screen', async ({ page }) => {
  await signIn(page, PEOPLE.harborOwner.email)
  await page.goto('/app/people')
  await page.getByRole('link', { name: /Ava Lindqvist/ }).click()
  await expect(page.getByRole('heading', { name: /Ava Lindqvist/ })).toBeVisible()
  await expectNoHorizontalOverflow(page, 'employee profile')
})

test('the employee surface fits a phone screen', async ({ page }) => {
  await signIn(page, PEOPLE.harborNewServer.email)
  await expectNoHorizontalOverflow(page, '/my')

  await page.getByRole('link', { name: 'Open your onboarding' }).click()
  await expect(page).toHaveURL(/\/my\/onboarding$/)
  await expectNoHorizontalOverflow(page, '/my/onboarding')
})

test('public pages fit a phone screen', async ({ page }) => {
  for (const path of ['/', '/pricing', '/contact', '/security', '/signin']) {
    await page.goto(path)
    await expectNoHorizontalOverflow(page, path)
  }
})

test('the communication surfaces fit a phone screen', async ({ page }) => {
  await signIn(page, PEOPLE.harborNewServer.email)
  await page.goto('/my/inbox')
  await expectNoHorizontalOverflow(page, '/my/inbox')

  await page
    .getByRole('link', { name: /Allergen handling/ })
    .first()
    .click()
  await expectNoHorizontalOverflow(page, '/my/inbox/[id]')

  await page.goto('/my/notifications')
  await expectNoHorizontalOverflow(page, '/my/notifications')
})

test('the schedule surfaces fit a phone screen', async ({ page }) => {
  await signIn(page, PEOPLE.harborEmployee.email)
  for (const path of ['/my/schedule', '/my/time-off', '/my/availability']) {
    await page.goto(path)
    await expectNoHorizontalOverflow(page, path)
  }
  await page.goto('/my/schedule')
  const shift = page.locator('a[href^="/my/schedule/shifts/"]').first()
  if ((await shift.count()) > 0) {
    await shift.click()
    await expect(page.getByText('Paid time')).toBeVisible()
    await expectNoHorizontalOverflow(page, '/my/schedule/shifts/[id]')
  }
})

test('a manager’s shift page fits a phone screen', async ({ page }) => {
  await signIn(page, PEOPLE.harborGmRiverside.email)
  await page.goto('/app/schedule')
  await page.locator('a[href^="/app/schedule/shifts/"]').first().click()
  await expect(page.getByRole('heading', { name: 'Who is on it' })).toBeVisible()
  await expectNoHorizontalOverflow(page, '/app/schedule/shifts/[id]')
})

test('the receipt report fits a phone screen', async ({ page }) => {
  await signIn(page, PEOPLE.harborHr.email)
  await page.goto('/app/comms')
  await page
    .getByRole('link', { name: /Allergen handling/ })
    .first()
    .click()
  await expect(page.getByRole('heading', { name: 'Who has read it' })).toBeVisible()
  await expectNoHorizontalOverflow(page, '/app/comms/[id]')
})

test('the training surfaces fit a phone screen', async ({ page }) => {
  await signIn(page, PEOPLE.harborOwner.email)
  await page.goto('/app/training')
  const course = await page
    .getByRole('link', { name: 'Allergen awareness for service' })
    .getAttribute('href')
  for (const path of [
    '/app/training',
    course!,
    `${course}/people`,
    `${course}/preview`,
    '/app/training/progress',
    '/app/training/sign-offs',
  ]) {
    await page.goto(path)
    await expectNoHorizontalOverflow(page, path)
  }

  await page.context().clearCookies()
  await signIn(page, PEOPLE.salonMassage.email)
  await page.goto('/my/training')
  await expectNoHorizontalOverflow(page, '/my/training')
  await page.locator('a[href^="/my/training/"]').first().click()
  await expectNoHorizontalOverflow(page, '/my/training/[id]')
  await page.locator('a[href*="/lessons/"]').first().click()
  await expectNoHorizontalOverflow(page, '/my/training/[id]/lessons/[id]')
})

test('linked onboarding training fits a phone screen', async ({ page }) => {
  await signIn(page, PEOPLE.salonNewStylist.email)
  await page.goto('/my/onboarding')
  await expectNoHorizontalOverflow(page, '/my/onboarding')
  await page.goto('/my')
  await expectNoHorizontalOverflow(page, '/my')
})

test('shift operations fit a phone screen', async ({ page }) => {
  await signIn(page, PEOPLE.harborGmRiverside.email)
  await page.goto('/app/operations/templates')
  const template = await page.getByRole('link', { name: 'Server side work' }).getAttribute('href')
  for (const path of [
    '/app/operations',
    '/app/operations/handoffs',
    '/app/operations/templates',
    template!,
  ]) {
    await page.goto(path)
    await expectNoHorizontalOverflow(page, path)
  }

  await page.context().clearCookies()
  await signIn(page, PEOPLE.harborOwner.email)
  await page.goto('/app/operations/templates/new')
  await expectNoHorizontalOverflow(page, '/app/operations/templates/new')

  await page.context().clearCookies()
  await signIn(page, PEOPLE.harborEmployee.email)
  for (const path of ['/my', '/my/shift']) {
    await page.goto(path)
    await expectNoHorizontalOverflow(page, path)
  }
})
