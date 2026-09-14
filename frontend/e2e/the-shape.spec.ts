import { expect, test } from '@playwright/test'

import { seedTrip } from './seed'

/**
 * Where things are, and where they are not.
 *
 * The app was organised like its database: four tabs that were four
 * tables, plus a drawer called "Altro" holding twelve rows — of which row
 * one was "Organizza il viaggio" and row two "Tappe". The only thing the
 * app is for, and the thing it cannot work without, both filed under
 * other. This walks the shape that replaced it, and fails if either ever
 * goes back in the drawer.
 */

/** Signed in already, once for the whole run: see `signed-in.setup.ts`. */

test('the trip leads with the one thing it is for', async ({ page }) => {
  const tripId = await seedTrip(page.request)
  await page.goto(`/trips/${tripId}`)

  // A button, not a hint that waits for the right conditions.
  const organise = page.getByRole('link', { name: /organizza il viaggio/i })
  await expect(organise).toBeVisible()
  await organise.click()
  await expect(page).toHaveURL(/\/plan$/)
})

test('it offers to organise a trip that has nothing in it yet', async ({ page }) => {
  // The person with no places is the one who needs the planner most, and
  // was the one person never offered it: the old prompt appeared only
  // once there were places already waiting to be arranged.
  const trip = await (
    await page.request.post('/api/trips', {
      data: {
        title: 'Vuoto',
        primary_tz: 'Europe/Rome',
        primary_currency: 'EUR',
        status: 'planned',
      },
    })
  ).json()

  await page.goto(`/trips/${trip.id}`)
  await expect(page.getByRole('link', { name: /organizza il viaggio/i })).toBeVisible()
  await expect(page.getByText(/ne cerco io/i)).toBeVisible()
})

test('the cities are at the top of the trip, not inside a drawer', async ({ page }) => {
  const tripId = await seedTrip(page.request)
  await page.goto(`/trips/${tripId}`)

  const spine = page.locator('.spine')
  await expect(spine).toContainText('Tokyo')
  await expect(spine).toContainText('Kyoto')
  await spine.click()
  await expect(page).toHaveURL(/\/stops$/)
})

test('what you have booked has a tab of its own', async ({ page }) => {
  const tripId = await seedTrip(page.request)
  await page.goto(`/trips/${tripId}`)

  await page.getByRole('link', { name: /^prenotazioni$/i }).click()
  await expect(page).toHaveURL(/\/bookings$/)
  // In the order it happens, and saying whether the paperwork is here.
  await expect(page.getByText(/Roma Fiumicino/).first()).toBeVisible()
  await expect(page.getByText(/nessun documento allegato/i).first()).toBeVisible()
})

test('the drawer no longer holds the two things the app is built on', async ({ page }) => {
  const tripId = await seedTrip(page.request)
  await page.goto(`/trips/${tripId}/more`)

  // By destination, not by label. Matching on text was how the first
  // version of this test passed without proving anything: the rows carry
  // a hint as well as a name, so an anchored `/^tappe$/` matched nothing
  // whether or not the row was there, and "expect zero" was always true.
  await expect(page.locator(`main a[href$="/plan"]`)).toHaveCount(0)
  await expect(page.locator(`main a[href$="/stops"]`)).toHaveCount(0)
  // And the map moved in, because looking at places is occasional.
  await expect(page.locator(`main a[href$="/map"]`)).toHaveCount(1)
})

test('the biggest button on the trip no longer asks for a flight number', async ({ page }) => {
  // It was a round green circle that added a *booking* — the control a
  // person reaches for when they want an itinerary, answering with a form
  // asking for a confirmation code.
  const tripId = await seedTrip(page.request)
  await page.goto(`/trips/${tripId}`)
  await expect(page.locator('.fab')).toHaveCount(0)
})

test('a pile of places can be cleared without forty confirmations', async ({ page }) => {
  // "Mi rimangono nella tab ed è fastidioso." Clearing a list you filled
  // from the suggestions was one tap and one confirm per row.
  const tripId = await seedTrip(page.request)
  await page.goto(`/trips/${tripId}/places`)
  // Waited for: `count()` does not, so counting straight after `goto`
  // counts an empty screen and then deletes nothing, successfully.
  await expect(page.getByRole('button', { name: /scegline più di uno/i })).toBeVisible()

  const before = await page.locator('.doc').count()
  expect(before).toBeGreaterThan(1)

  await page.getByRole('button', { name: /scegline più di uno/i }).click()
  await page.getByRole('button', { name: 'Seleziona tutti', exact: true }).click()

  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: `Elimina (${before})`, exact: true }).click()

  await expect(page.locator('.doc')).toHaveCount(0)
  expect(await page.request.get(`/api/trips/${tripId}/places`).then((r) => r.json())).toEqual([])
})

test('selecting all and then none leaves nothing chosen', async ({ page }) => {
  const tripId = await seedTrip(page.request)
  await page.goto(`/trips/${tripId}/places`)
  await expect(page.getByRole('button', { name: /scegline più di uno/i })).toBeVisible()

  await page.getByRole('button', { name: /scegline più di uno/i }).click()
  await page.getByRole('button', { name: 'Seleziona tutti', exact: true }).click()
  await page.getByRole('button', { name: 'Deseleziona tutti', exact: true }).click()

  // Nothing chosen, so nothing to delete — and the button says so.
  await expect(page.getByRole('button', { name: 'Elimina (0)', exact: true })).toBeDisabled()
})

test('a saved place keeps what it is and what it looks like', async ({ page }) => {
  // Both were shown while choosing and thrown away the moment you
  // accepted, so the list you ended up with was names again. They are
  // columns on the place now.
  await page.route('**/commons.wikimedia.org/**', (route) =>
    route.fulfill({ contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAAAAACw=', 'base64') }),
  )
  const tripId = await seedTrip(page.request)
  await page.request.post(`/api/trips/${tripId}/places`, {
    data: {
      name: 'Gokokuji',
      category: 'temple',
      description: 'tempio buddhista del 1681 a Bunkyō, Tokyo',
      image_url: 'http://commons.wikimedia.org/wiki/Special:FilePath/Gokokuji.jpg?width=320',
    },
  })

  await page.goto(`/trips/${tripId}/places`)
  const row = page.locator('.doc', { hasText: 'Gokokuji' })
  await expect(row.getByText('tempio buddhista del 1681 a Bunkyō, Tokyo')).toBeVisible()
  await expect(row.locator('.doc__photo')).toBeVisible()
})
