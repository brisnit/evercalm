import { expect, test } from '@playwright/test'
import { PEOPLE, signIn, trackConsoleErrors, expectNoConsoleErrors } from './helpers'

/**
 * Server-side authorization, proved by navigating DIRECTLY to routes whose
 * navigation entries are hidden. Hiding a link is a courtesy; the server
 * check is the gate, and this is what proves it.
 */
test.describe('authorization is enforced on the server, not by hiding links', () => {
  test('a location manager is not offered the audit log', async ({ page }) => {
    await signIn(page, PEOPLE.harborGmRiverside.email)
    const nav = page.getByRole('navigation', { name: 'Administration' })
    await expect(nav).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Audit log' })).toHaveCount(0)
  })

  test('...and is refused when navigating straight to its URL', async ({ page }) => {
    const errors = trackConsoleErrors(page)
    await signIn(page, PEOPLE.harborGmRiverside.email)

    await page.goto('/app/settings/audit')

    await expect(page.getByRole('heading', { name: /do not have access/i })).toBeVisible()
    // The page content must not render behind the notice.
    await expect(page.getByRole('table')).toHaveCount(0)
    expectNoConsoleErrors(errors)
  })

  test('a location manager cannot reach organization settings', async ({ page }) => {
    await signIn(page, PEOPLE.harborGmRiverside.email)
    await page.goto('/app/settings')
    await expect(page.getByRole('heading', { name: /do not have access/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Harbor & Vine' })).toHaveCount(0)
  })

  test('an owner reaches both, and can add a location', async ({ page }) => {
    await signIn(page, PEOPLE.harborOwner.email)

    await page.goto('/app/settings/audit')
    await expect(page.getByRole('table')).toBeVisible()

    await page.goto('/app/settings')
    await expect(page.getByRole('heading', { name: 'Harbor & Vine' })).toBeVisible()

    const unique = `Midtown ${Date.now().toString().slice(-5)}`
    await page.getByLabel('Location name').fill(unique)
    await page.getByLabel('City').fill('Sacramento')
    await page.getByRole('button', { name: 'Add location' }).click()

    await expect(page.getByRole('status')).toContainText(`Added ${unique}`)
    await expect(page.getByText(unique).first()).toBeVisible()

    // The write must have produced an audit entry in the same transaction.
    await page.goto('/app/settings/audit')
    await expect(page.getByRole('table')).toContainText(`Created location "${unique}"`)
  })

  test('an employee with no capabilities is routed to their own surface', async ({ page }) => {
    await signIn(page, PEOPLE.harborEmployee.email)
    await page.goto('/app')
    await expect(page).toHaveURL(/\/my$/)
    await expect(page.getByRole('heading', { name: /Hello, Sam/ })).toBeVisible()
  })

  test('signed-out visitors are sent to sign in', async ({ page }) => {
    await page.context().clearCookies()
    await page.goto('/app')
    await expect(page).toHaveURL(/\/signin/)
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  })

  test('a wrong password is refused without revealing whether the account exists', async ({
    page,
  }) => {
    await page.goto('/signin')
    await page.getByLabel('Email').fill(PEOPLE.harborOwner.email)
    await page.getByLabel('Password').fill('definitely-the-wrong-password')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByTestId('signin-error')).toBeVisible()
    const realAccountMessage = (await page.getByTestId('signin-error').textContent())?.trim()
    expect(realAccountMessage, 'the error message must not be empty').toBeTruthy()

    await page.goto('/signin')
    await page.getByLabel('Email').fill('nobody@nowhere.invalid')
    await page.getByLabel('Password').fill('definitely-the-wrong-password')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByTestId('signin-error')).toBeVisible()
    const unknownAccountMessage = (await page.getByTestId('signin-error').textContent())?.trim()

    // Identical wording either way: distinguishing them would turn the form
    // into an account enumeration oracle.
    expect(unknownAccountMessage).toBe(realAccountMessage)
  })
})
