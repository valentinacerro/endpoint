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
