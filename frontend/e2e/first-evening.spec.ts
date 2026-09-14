import { expect, test, type Page } from '@playwright/test'

/**
 * The first evening with the app, driven end to end.
 *
 * Written after a walkthrough found that the first question the app asked
 * was for a title — the one field it can do nothing with — and left a
 * newcomer at "now what?". This is the path as it is now, and it exists
 * so that it cannot quietly go back to that: every step here is one where
 * something used to stop.
 *
 * The geocoder is intercepted. Not to avoid the network but to avoid
 * testing Komoot's uptime: the flow is ours, their availability is not,
 * and a suite that goes red because a free service is busy stops being
 * read. `test_geocode.py` covers the real call.
 */

const PASSWORD = 'walkthrough'

/** One fixed answer, so the walk is about the app rather than the weather. */
async function stubLookup(page: Page) {
  await page.route('**/api/geo/search**', async (route) => {
    const query = new URL(route.request().url()).searchParams.get('q') ?? ''
    const hits = query.toLowerCase().startsWith('tok')
      ? [
          {
            name: 'Tokyo',
            lat: 35.6895,
            lon: 139.6917,
            where: 'Japan',
            address: null,
            category: 'sight',
            country: 'JP',
            tz: 'Asia/Tokyo',
          },
        ]
      : []
    await route.fulfill({ json: hits })
  })
}

async function signIn(page: Page) {
  await page.goto('/')
  await page.getByLabel(/password/i).fill(PASSWORD)
  await page.getByRole('button', { name: 'Entra' }).click()
}

/**
 * Dates relative to today, not written down.
 *
 * A fixed April 2026 made the home screen show a trip that had already
 * happened, which is a different screen with different links — and the
 * test would have quietly changed meaning as the date passed rather than
 * failing.
 */
function inDays(days: number): string {
  const day = new Date()
  day.setDate(day.getDate() + days)
  return day.toISOString().slice(0, 10)
}

const DEPARTS = inDays(30)
const RETURNS = inDays(44)

// One server, one database, one story: the second test looks at what the
// first one made.
test.describe.serial('the first evening', () => {
  test('sign in, say where you are going, and get a located stop for free', async ({ page }) => {
    await stubLookup(page)
    await signIn(page)

    // The home screen, with nothing on it yet.
    await expect(page.getByText(/nessun viaggio/i)).toBeVisible()

    await page.getByRole('link', { name: /nuovo viaggio|tutti i viaggi/i }).first().click()
    await page.getByRole('button', { name: /nuovo viaggio/i }).click()

    // The first question is where, not what to call it.
    const where = page.getByLabel(/dove vai/i)
    await expect(where).toBeVisible()
    await where.fill('Tokyo')

    // Choosing the suggestion is what makes the rest of the app work:
    // it carries the position and the time zone.
    await page.getByRole('button', { name: /^Tokyo/ }).click()
    await expect(page.getByText(/creo anche la prima tappa/i)).toBeVisible()

    await page.getByLabel('Partenza').fill(DEPARTS)
    await page.getByLabel('Ritorno').fill(RETURNS)
    await page.getByRole('button', { name: /^salva$/i }).click()

    // Landed inside the trip.
    await expect(page).toHaveURL(/\/trips\/[0-9a-f-]+$/)

    // And the first of the three steps is already done, because the
    // lookup answered it.
    const steps = page.locator('.step')
    await expect(steps.first()).toHaveClass(/step--done/)
    await expect(steps.nth(1)).not.toHaveClass(/step--done/)
  })

  test('the stop it made carries the destination’s zone, not the phone’s', async ({ page }) => {
    // The trap that made every booking land on the wrong day, silently.
    await stubLookup(page)
    await signIn(page)
    await page.getByRole('link', { name: 'Tutti i viaggi' }).first().click()
    await page.getByRole('link', { name: /Tokyo/ }).first().click()

    await page.getByRole('link', { name: /^altro$/i }).click()
    await page.getByRole('link', { name: /tappe/i }).click()

    await expect(page.getByText('Asia/Tokyo')).toBeVisible()
  })
})
