import { expect, test } from '@playwright/test'
import { PEOPLE, expectNoConsoleErrors, signIn, trackConsoleErrors } from './helpers'

/**
 * People, invitations, and onboarding in the browser.
 *
 * The assertions that matter most here are the privacy ones: a General Manager
 * must not receive sensitive employee information, and must not see staff from
 * a location they do not manage.
 */

test.describe('the employee directory', () => {
  test('lists this organization and nobody else', async ({ page }) => {
    const errors = trackConsoleErrors(page)
    await signIn(page, PEOPLE.harborOwner.email)
    await page.goto('/app/people')

    await expect(page.getByRole('heading', { name: 'Employee directory' })).toBeVisible()
    await expect(page.getByRole('table')).toContainText('Marcus Bell')
    await expect(page.getByRole('table')).toContainText('Ava Lindqvist')
    // Salon staff must never appear.
    await expect(page.getByRole('table')).not.toContainText('Marisol Vega')
    await expect(page.getByRole('table')).not.toContainText('Kofi Mensah')

    expectNoConsoleErrors(errors)
  })

  test('filters by name, and the filter survives the URL', async ({ page }) => {
    await signIn(page, PEOPLE.harborOwner.email)
    await page.goto('/app/people')

    await page.getByLabel('Search by name').fill('Marcus')
    await page.getByRole('button', { name: 'Search' }).click()

    await expect(page).toHaveURL(/q=Marcus/)
    await expect(page.getByRole('table')).toContainText('Marcus Bell')
    await expect(page.getByRole('table')).not.toContainText('Ava Lindqvist')
  })

  test('shows a location manager only their own location’s staff', async ({ page }) => {
    await signIn(page, PEOPLE.harborGmRiverside.email)
    await page.goto('/app/people')

    const table = page.getByRole('table')
    await expect(table).toContainText('Jordan Vega') // Riverside
    // Downtown staff must not be listed for the Riverside manager.
    await expect(table).not.toContainText('Tess Nakamura')
    await expect(table).not.toContainText('Theo Nakashima')
  })
})

test.describe('sensitive employee information', () => {
  test('is withheld from a General Manager, and says so plainly', async ({ page }) => {
    await signIn(page, PEOPLE.harborGmRiverside.email)
    await page.goto('/app/people')
    await page.getByRole('link', { name: /Sam Whitfield/ }).click()

    await expect(page.getByRole('heading', { name: 'Sam Whitfield' })).toBeVisible()
    await expect(page.getByText('Withheld')).toBeVisible()
    await expect(page.getByText(/sensitive-information permission/)).toBeVisible()
    // The actual values must not be on the page at all.
    await expect(page.getByText('sam@harborvine.test')).toHaveCount(0)
  })

  test('is available to HR', async ({ page }) => {
    await signIn(page, PEOPLE.harborHr.email)
    await page.goto('/app/people')
    await page.getByRole('link', { name: /Sam Whitfield/ }).click()
    await expect(page.getByText('sam@harborvine.test')).toBeVisible()
    await expect(page.getByText('Withheld')).toHaveCount(0)
  })
})

test.describe('invitations', () => {
  test('an owner can create one and gets a working link', async ({ page }) => {
    const errors = trackConsoleErrors(page)
    await signIn(page, PEOPLE.harborOwner.email)
    await page.goto('/app/people/invite')

    const unique = `browser.invite.${Date.now()}@example.test`
    await page.getByLabel('Full name').fill('Browser Invite')
    await page.getByLabel('Email').fill(unique)
    await page.getByLabel('Job title').fill('Server')
    await page.getByLabel('Applies to').selectOption('org')
    await page.getByRole('button', { name: 'Create invitation' }).click()

    await expect(page.getByRole('status')).toContainText('Invitation created for Browser Invite')
    await expect(page.getByRole('status')).toContainText('/invite/')

    await page.goto('/app/people/invitations')
    await expect(page.getByRole('table')).toContainText('Browser Invite')
    await expect(page.getByRole('table')).toContainText('Waiting')

    expectNoConsoleErrors(errors)
  })

  test('an employee cannot reach the invite screen', async ({ page }) => {
    await signIn(page, PEOPLE.harborEmployee.email)
    await page.goto('/app/people/invite')
    // Employees are redirected out of /app entirely.
    await expect(page).toHaveURL(/\/my/)
  })

  test('an invalid invitation link says so without revealing anything', async ({ page }) => {
    await page.context().clearCookies()
    await page.goto(`/invite/${'z'.repeat(43)}`)
    await expect(page.getByRole('heading', { name: /no longer valid/i })).toBeVisible()
    // No organization name, no email address.
    await expect(page.getByText('Harbor & Vine')).toHaveCount(0)
  })
})

test.describe('onboarding', () => {
  test('the board groups blocked and overdue people first', async ({ page }) => {
    const errors = trackConsoleErrors(page)
    await signIn(page, PEOPLE.harborOwner.email)
    await page.goto('/app/onboarding')

    await expect(page.getByRole('heading', { name: 'Onboarding', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: /Blocked/ })).toBeVisible()
    await expect(page.getByText('Dmitri Sokolov')).toBeVisible()
    await expect(page.getByText(/food handler card/i).first()).toBeVisible()

    expectNoConsoleErrors(errors)
  })

  test('a salon manager sees salon onboarding, with salon language', async ({ page }) => {
    await signIn(page, PEOPLE.salonOwner.email)
    await page.goto('/app/onboarding')

    await expect(page.getByText('Elodie Garnier')).toBeVisible()
    await expect(page.getByText(/state board/i).first()).toBeVisible()
    // Nothing from the restaurant tenant.
    await expect(page.getByText('Dmitri Sokolov')).toHaveCount(0)
  })
})

test.describe('company setup', () => {
  test('reports real progress from the workspace', async ({ page }) => {
    await signIn(page, PEOPLE.harborOwner.email)
    await page.goto('/app/setup')

    await expect(page.getByRole('heading', { name: 'Company setup' })).toBeVisible()
    await expect(page.getByRole('progressbar')).toBeVisible()
    // The seeded tenant has locations, roles, values and people, so these
    // steps must report as done rather than as an empty checklist.
    await expect(page.getByText('Done').first()).toBeVisible()
  })
})

test.describe('the two tenants do not share vocabulary', () => {
  test('the restaurant has a bar and a host stand', async ({ page }) => {
    await signIn(page, PEOPLE.harborOwner.email)
    await page.goto('/app/settings/structure')

    await expect(page.getByText('Host Stand').first()).toBeVisible()
    await expect(page.getByText('Server', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Colour Bar')).toHaveCount(0)
    await expect(page.getByText('Chair 1')).toHaveCount(0)
  })

  test('the salon has chairs, a colour bar, and treatment rooms', async ({ page }) => {
    await signIn(page, PEOPLE.salonOwner.email)
    await page.goto('/app/settings/structure')

    await expect(page.getByText('Chair 1').first()).toBeVisible()
    await expect(page.getByText('Colour Bar').first()).toBeVisible()
    await expect(page.getByText('Treatment Room 1')).toBeVisible()
    // No restaurant vocabulary anywhere.
    await expect(page.getByText('Host Stand')).toHaveCount(0)
    await expect(page.getByText('Dish Pit')).toHaveCount(0)
    await expect(page.getByText('86')).toHaveCount(0)
  })

  test('each tenant writes its own values and standards', async ({ page }) => {
    await signIn(page, PEOPLE.salonOwner.email)
    await page.goto('/app/settings/values')
    await expect(page.getByText(/Licences are current before the floor/)).toBeVisible()
    await expect(page.getByText(/patch tested/i)).toBeVisible()

    await page.context().clearCookies()
    await signIn(page, PEOPLE.harborOwner.email)
    await page.goto('/app/settings/values')
    await expect(page.getByText(/Allergies are repeated back/)).toBeVisible()
    await expect(page.getByText(/Licences are current before the floor/)).toHaveCount(0)
  })
})

test.describe('professional credentials', () => {
  test('surface expiry on the salon dashboard', async ({ page }) => {
    await signIn(page, PEOPLE.salonOwner.email)
    await page.goto('/app')
    // Home keeps the count; the detail is one click away.
    await page.getByTestId('attention-summary').click()
    await expect(page).toHaveURL(/\/app\/attention$/)

    await expect(page.getByText('Credentials to chase')).toBeVisible()
    // Priyanka's licence is seeded as already expired.
    await expect(page.getByText('Priyanka Shah')).toBeVisible()
    await expect(page.getByText('Expired').first()).toBeVisible()
  })

  test('hide the licence number from a manager without the sensitive permission', async ({
    page,
  }) => {
    await signIn(page, PEOPLE.salonGmPearl.email)
    await page.goto('/app/people')
    await page.getByRole('link', { name: /Marisol Vega/ }).click()

    await expect(page.getByText('Cosmetology Licence')).toBeVisible()
    // Expiry is visible so cover can be planned; the number is not.
    await expect(page.getByText('OR-CO-098221')).toHaveCount(0)
    await expect(page.getByText(/Licence numbers are hidden/)).toBeVisible()
  })
})
