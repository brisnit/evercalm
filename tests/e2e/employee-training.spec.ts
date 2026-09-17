import { expect, test, type Page } from '@playwright/test'
import { PEOPLE, signIn } from './helpers'

/**
 * The employee's training, on a desktop and on a phone. Each project uses its
 * own apprentice-level learner on the same seeded salon course, so the two
 * runs never consume each other's state.
 */

async function expectNoSidewaysScroll(page: Page) {
  const { scrollWidth, viewport } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }))
  expect(scrollWidth, `${page.url()} scrolls sideways`).toBeLessThanOrEqual(viewport + 1)
}

test('a learner sees what is done and next, works through lessons, and asks for sign-off', async ({
  page,
}, info) => {
  test.setTimeout(120_000)
  const learner = info.project.name === 'mobile' ? PEOPLE.salonNewStylist : PEOPLE.salonApprentice
  await signIn(page, learner.email)

  await page.goto('/my')
  await expect(page.getByRole('heading', { name: 'Your training' })).toBeVisible()

  await page.goto('/my/training')
  // Whatever is most pressing is next up; both learners have this course to do.
  await expect(page.getByText('Next up')).toBeVisible()
  for (const figure of ['Completed', 'To do', 'Left']) {
    await expect(page.getByRole('term').filter({ hasText: figure })).toBeVisible()
  }
  await expectNoSidewaysScroll(page)
  await page
    .getByRole('link', { name: /Patch testing and colour consultation Next: Before you mix/ })
    .click()
  await expect(page.getByRole('progressbar', { name: '2 of 5 lessons done' })).toBeVisible()

  // The checklist: save part, then finish it.
  await page.getByRole('link', { name: /^Continue/ }).click()
  await expect(page.getByRole('heading', { name: 'Before you mix', level: 1 })).toBeVisible()
  await page.waitForLoadState('networkidle')
  // Each tick saves itself: there is no save button to miss, and leaving and
  // coming back keeps the tick.
  await expect(page.getByRole('button', { name: 'Save progress' })).toHaveCount(0)
  await page.getByLabel('The formula card is updated before you mix').check()
  await expect(page.getByTestId('checklist-save-status')).toHaveText('Progress saved')
  await page.getByTestId('training-trail').getByRole('link', { name: 'Exit to Training' }).click()
  await expect(page).toHaveURL(/\/my\/training$/)
  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Before you mix', level: 1 })).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('The formula card is updated before you mix')).toBeChecked()
  for (const box of await page.getByRole('checkbox').all()) await box.check()
  await expect(page.getByTestId('lesson-moment')).toContainText(
    'Halfway there: 3 of 5 lessons done. Next: Knowledge check.',
  )
  await expectNoSidewaysScroll(page)

  // The knowledge check: a miss, then a pass.
  await page.getByTestId('lesson-moment').getByRole('link', { name: 'Next lesson' }).click()
  await page.waitForLoadState('networkidle')
  const answer = async (wrong: boolean) => {
    await page
      .getByLabel(wrong ? 'At the start of the appointment' : '48 hours before the appointment')
      .check()
    for (const label of [
      'A new colour guest',
      'A regular whose last colour with us was eight months ago',
      'A regular who has started a new medication',
    ]) {
      await page.getByLabel(label).check()
    }
    await page.getByLabel(wrong ? 'True' : 'False', { exact: true }).check()
    await page.getByLabel('A strand test').check()
    await page.getByLabel('Do not colour today, and explain why').check()
    await page.getByRole('button', { name: 'Submit answers' }).click()
  }
  await answer(true)
  await expect(page.getByText(/Not yet: 3 of 5 correct, and a pass needs 4/)).toBeVisible()
  await expect(page.getByText('Not quite last time.').first()).toBeVisible()
  await answer(false)
  await expect(page.getByTestId('lesson-moment')).toContainText('Passed: 5 of 5 correct.')
  await expect(page.getByRole('heading', { name: 'Your answers' })).toBeVisible()
  await expectNoSidewaysScroll(page)

  // The practical waits for a manager.
  await page.getByTestId('lesson-moment').getByRole('link', { name: 'Next lesson' }).click()
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'I’m ready for sign-off' }).click()
  await expect(page.getByTestId('lesson-moment')).toContainText('Sign-off requested.')
  await expect(page.getByText('Waiting for sign-off').first()).toBeVisible()

  await page.getByTestId('training-trail').getByRole('link', { name: 'Course overview' }).click()
  await expect(page.getByRole('progressbar', { name: '4 of 5 lessons done' })).toBeVisible()
  await expect(page.getByText(/Waiting for a manager to sign off your practical/)).toBeVisible()
})

test('a completed course shows what was achieved', async ({ page }) => {
  await signIn(page, PEOPLE.salonNewStylist.email)
  await page.goto('/my/training')
  await page.getByRole('link', { name: /Disinfection between guests/ }).click()
  await expect(page.getByText('Course complete')).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'You finished Disinfection between guests' }),
  ).toBeVisible()
  await expect(page.getByText('Passed · 100%')).toBeVisible()
  await expectNoSidewaysScroll(page)
})

test('someone else’s training is not found', async ({ page }) => {
  await signIn(page, PEOPLE.salonMassage.email)
  const response = await page.goto('/my/training/00000000-0000-4000-8000-000000000000')
  expect(response?.status()).toBe(404)
})
