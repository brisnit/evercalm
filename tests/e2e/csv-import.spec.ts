import { expect, test } from '@playwright/test'
import { PEOPLE, expectNoConsoleErrors, signIn, trackConsoleErrors } from './helpers'

/**
 * The CSV import wizard.
 *
 * Uses the SALON tenant so that a restaurant assumption in matching would show
 * up as a failure here.
 */

function csvFile(name: string, contents: string) {
  return { name, mimeType: 'text/csv', buffer: Buffer.from(contents, 'utf8') }
}

test('a salon administrator can import people end to end', async ({ page }) => {
  const errors = trackConsoleErrors(page)
  await signIn(page, PEOPLE.salonOwner.email)
  await page.goto('/app/people/import')

  await expect(page.getByRole('heading', { name: 'Import from a spreadsheet' })).toBeVisible()
  // Salon vocabulary, not restaurant.
  await expect(page.getByText('Pearl District')).toBeVisible()
  await expect(page.getByText('Colour Specialist')).toBeVisible()

  const stamp = Date.now().toString().slice(-6)
  await page.setInputFiles(
    '#import-file',
    csvFile(
      'salon-team.csv',
      [
        'Full name,Email,Job title,Salon,Role',
        `Nadia Okonjo ${stamp},nadia.${stamp}@example.test,Stylist,Pearl District,Stylist`,
        `Bad Row ${stamp},not-an-email,Stylist,Pearl District,Stylist`,
      ].join('\n'),
    ),
  )
  await page.getByRole('button', { name: 'Read the file' }).click()

  await expect(page.getByRole('heading', { name: '2. Match your columns' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '3. Review every row' })).toBeVisible()
  await expect(page.getByText('1 ready to import')).toBeVisible()
  await expect(page.getByText('1 with problems')).toBeVisible()
  await expect(page.getByText(/is not a valid email address/)).toBeVisible()

  await page.getByRole('button', { name: /^Import 1 person$/ }).click()
  await expect(page.getByRole('heading', { name: 'Import complete' })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('Imported 1 person')

  await page.goto('/app/people')
  await page.getByLabel('Search by name').fill(`Nadia Okonjo ${stamp}`)
  await page.getByRole('button', { name: 'Search' }).click()
  await expect(page.getByRole('table')).toContainText(`Nadia Okonjo ${stamp}`)
  await expect(page.getByRole('table')).toContainText('Invited')

  expectNoConsoleErrors(errors)
})

test('the preview creates nobody until it is confirmed', async ({ page }) => {
  await signIn(page, PEOPLE.salonOwner.email)
  await page.goto('/app/people/import')

  const stamp = Date.now().toString().slice(-6)
  await page.setInputFiles(
    '#import-file',
    csvFile('preview.csv', `Full name,Email\nPreview Ghost ${stamp},ghost.${stamp}@example.test`),
  )
  await page.getByRole('button', { name: 'Read the file' }).click()
  await expect(page.getByText('1 ready to import')).toBeVisible()

  // Navigate away without confirming.
  await page.goto('/app/people')
  await page.getByLabel('Search by name').fill(`Preview Ghost ${stamp}`)
  await page.getByRole('button', { name: 'Search' }).click()
  await expect(page.getByText('Nobody matches those filters')).toBeVisible()
})

test('a file that is not a CSV is refused', async ({ page }) => {
  await signIn(page, PEOPLE.salonOwner.email)
  await page.goto('/app/people/import')

  await page.setInputFiles('#import-file', {
    name: 'photo.png',
    mimeType: 'image/png',
    buffer: Buffer.from('not really a png'),
  })
  await page.getByRole('button', { name: 'Read the file' }).click()
  await expect(page.getByTestId('import-error')).toContainText('does not look like a CSV')
})

test('restaurant vocabulary is rejected in the salon', async ({ page }) => {
  await signIn(page, PEOPLE.salonOwner.email)
  await page.goto('/app/people/import')

  const stamp = Date.now().toString().slice(-6)
  await page.setInputFiles(
    '#import-file',
    csvFile(
      'wrong.csv',
      `Full name,Email,Location,Role\nWrong Words ${stamp},wrong.${stamp}@example.test,Riverside,Line Cook`,
    ),
  )
  await page.getByRole('button', { name: 'Read the file' }).click()

  await expect(page.getByText('1 with problems')).toBeVisible()
  await expect(page.getByText(/No location called "Riverside"/)).toBeVisible()
  await expect(page.getByText(/No job role called "Line Cook"/)).toBeVisible()
  // Nothing to import, so no confirmation step is offered at all.
  await expect(page.getByRole('heading', { name: '4. Confirm' })).toHaveCount(0)
})

test('an employee cannot reach the importer', async ({ page }) => {
  await signIn(page, PEOPLE.harborEmployee.email)
  await page.goto('/app/people/import')
  await expect(page).toHaveURL(/\/my/)
})
