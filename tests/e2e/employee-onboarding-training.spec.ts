import { expect, test, type Page } from '@playwright/test'
import { PEOPLE, signIn } from './helpers'

/**
 * A new hire works through a course their onboarding gave them, on a desktop
 * and on a phone. Each project uses its own new hire, so the two runs never
 * consume each other's state:
 *
 *   desktop  Tomas, salon front desk: finishing the course completes the step
 *   phone    Dmitri, restaurant kitchen: the practical waits for a manager,
 *            the step waits with it, and the sign-off completes both
 */

async function expectNoSidewaysScroll(page: Page) {
  const { scrollWidth, viewport } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }))
  expect(scrollWidth, `${page.url()} scrolls sideways`).toBeLessThanOrEqual(viewport + 1)
}

async function finishLessonsUntilQuiz(page: Page) {
  await page.getByRole('button', { name: 'Mark as done' }).click()
  await page.getByTestId('lesson-moment').getByRole('link', { name: 'Next lesson' }).click()
  // `.all()` does not wait: be sure the checklist has rendered first.
  await expect(page.getByRole('checkbox').first()).toBeVisible()
  await page.waitForLoadState('networkidle')
  for (const box of await page.getByRole('checkbox').all()) await box.check()
  await page.getByRole('button', { name: 'Mark as done' }).click()
  await page.getByTestId('lesson-moment').getByRole('link', { name: 'Next lesson' }).click()
  await page.waitForLoadState('networkidle')
}

test('the home screen leads with the course while another onboarding item waits', async ({
  page,
}) => {
  // Both have a linked course next AND one onboarding item blocked elsewhere:
  // Elodie's licence check, Dmitri's food handler card. Runs before the journey
  // below, which changes Dmitri's course on the phone.
  const people = [
    { email: PEOPLE.salonNewStylist.email, course: 'Patch testing and colour consultation' },
    { email: 'dmitri@harborvine.test', course: 'Hot holding, cooling and reheating' },
  ]
  for (const { email, course } of people) {
    await page.context().clearCookies()
    await signIn(page, email)
    await page.goto('/my')
    const onboarding = page.getByTestId('onboarding-card')
    await expect(onboarding.getByRole('link', { name: `Continue ${course}` })).toBeVisible()
    await expect(onboarding.getByText('1 item waiting', { exact: true })).toBeVisible()
    await expect(onboarding.getByText(/You can carry on with this in the meantime\./)).toBeVisible()
    // Not the contradictory badge.
    await expect(onboarding.getByText('Waiting', { exact: true })).toHaveCount(0)
    // The training card does not repeat the course.
    await expect(
      page.getByText('Your next lesson is part of your onboarding, above.'),
    ).toBeVisible()
    await expect(page.locator('a[href*="/lessons/"]')).toHaveCount(1)
    // No development placeholder on an employee's home screen.
    await expect(page.getByText(/later slice/i)).toHaveCount(0)
    await expectNoSidewaysScroll(page)
  }
})

test('onboarding training, from the checklist through the course and back', async ({
  page,
}, info) => {
  test.setTimeout(150_000)
  const phone = info.project.name === 'mobile'
  const person = phone ? 'dmitri@harborvine.test' : 'tomas@lumensalon.test'
  const stepTitle = phone ? 'Hot holding and cooling training' : 'Rebooking and retail training'

  await signIn(page, person)
  await page.goto('/my/onboarding')
  const step = () => page.getByRole('main').getByRole('listitem').filter({ hasText: stepTitle })
  await expect(step().getByText('Not started')).toBeVisible()
  await expectNoSidewaysScroll(page)
  await step().getByRole('link', { name: 'Start the course' }).click()
  await page.waitForLoadState('networkidle')

  await finishLessonsUntilQuiz(page)
  await expect(page.getByRole('button', { name: 'Submit answers' })).toBeVisible()

  if (!phone) {
    await page.getByLabel('Two specific times the provider recommends').check()
    await page.getByLabel('True', { exact: true }).check()
    await page.getByLabel('Thank them and offer a reminder text').check()
    await page.getByRole('button', { name: 'Submit answers' }).click()
    await expect(page.getByTestId('lesson-moment')).toContainText(
      'You finished Rebooking and retail at the desk.',
    )

    await page.goto('/my/onboarding')
    await expect(step().getByText('Course complete')).toBeVisible()
    await expect(step().getByText('Done', { exact: true })).toBeVisible()
    return
  }

  // 135°F is an answer to two questions; this is the hot-holding one.
  await page
    .getByRole('group', { name: /minimum temperature for hot holding/ })
    .getByLabel('135°F', { exact: true })
    .check()
  await page.getByLabel('5:00 pm').check()
  await page.getByLabel('False', { exact: true }).check()
  await page.getByLabel('165°F within 2 hours').check()
  await page.getByRole('button', { name: 'Submit answers' }).click()
  await expect(page.getByTestId('lesson-moment')).toContainText('Passed: 4 of 4 correct.')
  await page.getByTestId('lesson-moment').getByRole('link', { name: 'Next lesson' }).click()
  await expect(page.getByRole('button', { name: 'I’m ready for sign-off' })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'I’m ready for sign-off' }).click()
  await expect(page.getByTestId('lesson-moment')).toContainText('Sign-off requested.')

  // Waiting, not complete - and not something Dmitri can finish himself.
  await page.goto('/my/onboarding')
  await expect(step().getByText('Waiting for sign-off')).toBeVisible()
  await expect(step().getByText('To do', { exact: true })).toBeVisible()
  await expectNoSidewaysScroll(page)

  await page.context().clearCookies()
  await signIn(page, PEOPLE.harborGmRiverside.email)
  await page.goto('/app/training/sign-offs')
  const card = page.getByRole('article').filter({ hasText: 'Dmitri Sokolov' })
  await page.waitForLoadState('networkidle')
  for (const box of await card.getByRole('checkbox').all()) await box.check()
  await card.getByRole('button', { name: 'Sign off' }).click()
  await expect(page.getByTestId('action-notice')).toContainText(
    'Signed off for Dmitri Sokolov. That completes their course.',
  )
  await expectNoSidewaysScroll(page)

  await page.context().clearCookies()
  await signIn(page, person)
  await page.goto('/my/onboarding')
  await expect(step().getByText('Course complete')).toBeVisible()
  await expect(step().getByText('Done', { exact: true })).toBeVisible()
})
