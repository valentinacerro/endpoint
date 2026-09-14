import { expect, test, type Page } from '@playwright/test'

import { seedTrip } from './seed'

/**
 * The map, and the one header that made it a wall of "Access blocked".
 *
 * OpenStreetMap's tile policy asks for a Referer or a User-Agent that
 * identifies the application. A browser sends its own user agent, which
 * identifies the browser; this app sets `Referrer-Policy: no-referrer` on
 * every response, which took away the only other answer. Every tile came
 * back stamped "App is not following the tile usage policy".
 *
 * So there are two things to hold still here, and they pull in opposite
 * directions: the tiles must carry a Referer, and it must never be more
 * than the origin — the path holds the trip's id, and this app does not
 * hand a third party the list of what it is looking at.
 */

const PASSWORD = 'walkthrough'

async function signIn(page: Page) {
  await page.goto('/')
  await page.getByLabel(/password/i).fill(PASSWORD)
  await page.getByRole('button', { name: 'Entra' }).click()
  await expect(page.getByRole('link', { name: 'Tutti i viaggi' }).first()).toBeVisible()
}

test('the tiles are asked for in a way OpenStreetMap will answer', async ({ page }) => {
  await signIn(page)
  const tripId = await seedTrip(page.request)

  // Intercepted rather than fetched for real: what is being tested is the
  // request this app makes, and OSM's availability is not ours to test.
  const referers: (string | undefined)[] = []
  await page.route('https://tile.openstreetmap.org/**', async (route) => {
    referers.push(route.request().headers()['referer'])
    // A transparent 1×1 PNG, so Leaflet has something to draw.
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64',
      ),
    })
  })

  await page.goto(`/trips/${tripId}/map`)
  await expect.poll(() => referers.length, { timeout: 10_000 }).toBeGreaterThan(0)

  const origin = new URL(page.url()).origin
  for (const referer of referers) {
    // Present, or OSM cannot tell who is asking and refuses.
    expect(referer, 'a tile was requested with no Referer at all').toBeTruthy()
    // And no more than the origin: the path carries the trip's id.
    expect(referer).toBe(`${origin}/`)
  }
})

test('every response still carries the headers that made this hard', async ({ page }) => {
  // The fix was to make one request send a Referer, not to stop protecting
  // the rest. If this ever goes green with the policy gone, the map would
  // work for the wrong reason.
  const response = await page.request.get('/')
  expect(response.headers()['referrer-policy']).toBe('no-referrer')
  expect(response.headers()['x-content-type-options']).toBe('nosniff')
})
