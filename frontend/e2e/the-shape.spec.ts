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

test('a day can be told what kind of day it is', async ({ page }) => {
  // "Per ogni giorno dovremmo fare una piccola profilazione." Without it
  // the planner has one idea of a good day, so a fortnight comes out as
  // fourteen days of the same shape.
  const tripId = await seedTrip(page.request)
  await page.goto(`/trips/${tripId}`)

  const day = page.locator('.day').first()
  await expect(day.getByRole('button', { name: 'Negozi' })).toBeVisible()
  await day.getByRole('button', { name: 'Negozi' }).click()
  await expect(day.getByRole('button', { name: 'Negozi' })).toHaveAttribute('aria-pressed', 'true')

  // It reaches the server, under the day it was pressed on.
  await expect
    .poll(async () => {
      const bundle = await page.request.get(`/api/trips/${tripId}/bundle`).then((r) => r.json())
      return bundle.day_notes.map((note: { theme: string | null }) => note.theme)
    })
    .toEqual(['shopping'])

  // And pressing it again takes it off, because "no theme" is an answer.
  // The row goes with it: a day that says nothing needs no row, and the
  // server refuses to store one — clearing is a DELETE.
  await day.getByRole('button', { name: 'Negozi' }).click()
  await expect
    .poll(async () => {
      const bundle = await page.request.get(`/api/trips/${tripId}/bundle`).then((r) => r.json())
      return bundle.day_notes.length
    })
    .toBe(0)
})

test('choosing a theme does not throw away the note under it', async ({ page }) => {
  // One row per day holds both, so a write that sent only the theme would
  // wipe a sentence written ten minutes earlier.
  const tripId = await seedTrip(page.request)
  const bundle = await page.request.get(`/api/trips/${tripId}/bundle`).then((r) => r.json())
  const day = bundle.stops[0].arrive_date
  await page.request.put(`/api/trips/${tripId}/days/${day}/note`, {
    data: { note: 'chiuso il lunedì' },
  })

  await page.goto(`/trips/${tripId}`)
  await page.locator('.day', { hasText: 'chiuso il lunedì' }).getByRole('button', { name: 'Musei' }).click()

  await expect
    .poll(async () => {
      const after = await page.request.get(`/api/trips/${tripId}/bundle`).then((r) => r.json())
      const note = after.day_notes.find((n: { day: string }) => n.day === day)
      return [note?.note, note?.theme]
    })
    .toEqual(['chiuso il lunedì', 'museums'])
})

test('a visit on the itinerary opens, like a booking always did', async ({ page }) => {
  // "Non è cliccabile." A booking was a link to its own screen; a visit
  // was a div with two arrows on it — so the thing you look at fourteen
  // times a day had nowhere to go.
  await page.route('**/commons.wikimedia.org/**', (route) =>
    route.fulfill({ contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAAAAACw=', 'base64') }),
  )
  const tripId = await seedTrip(page.request)
  const bundle = await page.request.get(`/api/trips/${tripId}/bundle`).then((r) => r.json())
  const stop = bundle.stops[0]
  const place = await (
    await page.request.post(`/api/trips/${tripId}/places`, {
      data: {
        name: 'Gokokuji',
        category: 'temple',
        stop_id: stop.id,
        lat: 35.7166,
        lon: 139.7256,
        description: 'tempio buddhista del 1681 a Bunkyō',
        image_url: 'http://commons.wikimedia.org/wiki/Special:FilePath/Gokokuji.jpg?width=320',
        planned_start_at: `${stop.arrive_date}T01:00:00Z`,
        planned_tz: 'Asia/Tokyo',
      },
    })
  ).json()

  await page.goto(`/trips/${tripId}`)
  const row = page.locator('.entry', { hasText: 'Gokokuji' })
  // It reads as a day rather than a spreadsheet: a picture and a line
  // saying what the thing is.
  await expect(row.locator('.entry__photo')).toBeVisible()
  await expect(row.getByText('tempio buddhista del 1681 a Bunkyō')).toBeVisible()

  await row.getByRole('link', { name: /Gokokuji/ }).click()
  await expect(page).toHaveURL(new RegExp(`/places/${place.id}$`))
  // By the element, not by the words: the same sentence is on the row
  // you just left, so matching on text passes whether or not this screen
  // says anything.
  await expect(page.locator('.place__what')).toHaveText('tempio buddhista del 1681 a Bunkyō')
  await expect(page.locator('.place__photo')).toBeVisible()
  await expect(page.getByRole('link', { name: /apri in maps/i })).toBeVisible()
})

test('a place can be taken off its day from its own screen', async ({ page }) => {
  const tripId = await seedTrip(page.request)
  const bundle = await page.request.get(`/api/trips/${tripId}/bundle`).then((r) => r.json())
  const stop = bundle.stops[0]
  const place = await (
    await page.request.post(`/api/trips/${tripId}/places`, {
      data: {
        name: 'Zōjō-ji', category: 'temple', stop_id: stop.id,
        planned_start_at: `${stop.arrive_date}T02:00:00Z`, planned_tz: 'Asia/Tokyo',
      },
    })
  ).json()

  await page.goto(`/trips/${tripId}/places/${place.id}`)
  await page.getByRole('button', { name: 'Togli dal programma' }).click()

  await expect
    .poll(async () =>
      (await page.request.get(`/api/trips/${tripId}/places/${place.id}`).then((r) => r.json()))
        .planned_start_at,
    )
    .toBeNull()
})
