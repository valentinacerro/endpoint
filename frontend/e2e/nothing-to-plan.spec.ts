import { expect, test, type Page } from '@playwright/test'

/**
 * A trip with cities and no places at all.
 *
 * The state everybody's first evening is actually in, and the one the app
 * handled worst: it could find places and it could order places, on two
 * different screens, and left you to work out which you needed. Pressing
 * "organise the trip" produced an empty fortnight and a list of
 * complaints.
 *
 * One button now. It plans, asks the plan which days came out empty, goes
 * and looks around those cities, and plans again — and still changes
 * nothing until you confirm.
 *
 * Discovery is intercepted: what is being tested is the app joining its
 * own halves, and Overpass's uptime is not ours to test. `test_discover.py`
 * covers the real call.
 */

const PHOTO = 'http://commons.wikimedia.org/wiki/Special:FilePath/Senso-ji.jpg?width=320'

const AROUND_TOKYO = [
  { name: 'Sensō-ji', lat: 35.7148, lon: 139.7967, category: 'temple', fame: 90, wikidata: 'Q206144', osm_id: 'w/1',
    description: 'tempio buddhista ad Asakusa, Tokyo', image: PHOTO },
  { name: 'Tokyo National Museum', lat: 35.7188, lon: 139.7765, category: 'museum', fame: 80, wikidata: 'Q653433', osm_id: 'w/2' },
  { name: 'Ueno Park', lat: 35.7141, lon: 139.7744, category: 'park', fame: 70, wikidata: null, osm_id: 'w/3' },
  { name: 'Meiji Jingū', lat: 35.6764, lon: 139.6993, category: 'shrine', fame: 85, wikidata: 'Q383981', osm_id: 'w/4' },
  { name: 'Shibuya Crossing', lat: 35.6595, lon: 139.7005, category: 'sight', fame: 60, wikidata: null, osm_id: 'w/5' },
  { name: 'Tsukiji Outer Market', lat: 35.6654, lon: 139.7707, category: 'food', fame: 55, wikidata: null, osm_id: 'w/6' },
]

/** Signed in already, once for the whole run: see `signed-in.setup.ts`. */

/** A trip with one located city, dates, and deliberately nothing else. */
async function bareTrip(page: Page): Promise<string> {
  const day = (offset: number) => {
    const d = new Date()
    d.setDate(d.getDate() + offset)
    return d.toISOString().slice(0, 10)
  }
  const trip = await (
    await page.request.post('/api/trips', {
      data: {
        title: 'Giappone',
        start_date: day(30),
        end_date: day(33),
        primary_tz: 'Europe/Rome',
        primary_currency: 'EUR',
        status: 'planned',
      },
    })
  ).json()
  await page.request.post(`/api/trips/${trip.id}/stops`, {
    data: {
      name: 'Tokyo',
      tz: 'Asia/Tokyo',
      country_code: 'JP',
      lat: 35.6896,
      lon: 139.7006,
      arrive_date: day(30),
      depart_date: day(33),
    },
  })
  return trip.id as string
}

test('one button turns an empty trip into an itinerary', async ({ page }) => {
  await page.route('**/api/geo/discover**', (route) => route.fulfill({ json: AROUND_TOKYO }))
  const tripId = await bareTrip(page)

  await page.goto(`/trips/${tripId}/plan`)
  await page.getByRole('button', { name: 'Calcola il piano' }).click()

  // It says what it did, and why: these are not places she collected.
  await expect(page.getByText(/li ho trovati io, a Tokyo/i)).toBeVisible()
  await expect(page.getByText('Sensō-ji')).toBeVisible()

  // Still nothing saved. The whole design rests on this.
  expect(await page.request.get(`/api/trips/${tripId}/places`).then((r) => r.json())).toEqual([])

  await page.getByRole('button', { name: /^applica$/i }).click()

  // What the *screen* does, not only what the server stored. Every test
  // here checked the database and none checked the app, so pressing
  // Applica could leave you exactly where you were — preview gone, a
  // small line under a button — and the run stayed green.
  await expect(page).toHaveURL(new RegExp(`/trips/${tripId}$`))
  await expect(page.getByText(/applicat[ae] .*visit/i)).toBeVisible()
  // And the days now have something on them.
  await expect(page.getByText('Sensō-ji').first()).toBeVisible()

  // Counted exactly, not "more than none". `toBeGreaterThan(0)` was what
  // this said before, and it passed happily while nineteen of twenty
  // places were still being saved one request at a time — the run went
  // green and the trip came out with one place on it.
  await expect
    .poll(
      async () =>
        (await page.request.get(`/api/trips/${tripId}/places`).then((r) => r.json())).length,
      { timeout: 15_000 },
    )
    .toBe(AROUND_TOKYO.length)

  const places = await page.request.get(`/api/trips/${tripId}/places`).then((r) => r.json())
  expect(places.filter((p: { planned_start_at: string | null }) => p.planned_start_at).length)
    .toBeGreaterThan(0)
  // Saved as real places, in the city it looked in, at the city's zone —
  // not the phone's, which is the trap that moves everything a day.
  for (const place of places) {
    expect(place.stop_id).not.toBeNull()
    if (place.planned_start_at) expect(place.planned_tz).toBe('Asia/Tokyo')
  }
})

test('a place dropped from the proposals is never saved', async ({ page }) => {
  await page.route('**/api/geo/discover**', (route) => route.fulfill({ json: AROUND_TOKYO }))
  const tripId = await bareTrip(page)

  await page.goto(`/trips/${tripId}/plan`)
  await page.getByRole('button', { name: 'Calcola il piano' }).click()
  await expect(page.getByText('Sensō-ji')).toBeVisible()

  await page
    .locator('.doc', { hasText: 'Sensō-ji' })
    .getByRole('button', { name: /elimina/i })
    .click()
  await expect(page.getByText('Sensō-ji')).toBeHidden()

  await page.getByRole('button', { name: /^applica$/i }).click()
  await expect
    .poll(
      async () =>
        (await page.request.get(`/api/trips/${tripId}/places`).then((r) => r.json())).length,
      { timeout: 15_000 },
    )
    .toBe(AROUND_TOKYO.length - 1)

  const names = (await page.request.get(`/api/trips/${tripId}/places`).then((r) => r.json()))
    .map((p: { name: string }) => p.name)
  expect(names).not.toContain('Sensō-ji')
})

test('it says which city it is asking about, and does not sit there mute', async ({ page }) => {
  // Overpass is free, run on donations, and measured at anything from one
  // second to the better part of a minute. A button that says nothing for
  // that long reads as broken; this is the difference between busy and
  // broken.
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/geo/discover**', async (route) => {
    await held
    await route.fulfill({ json: AROUND_TOKYO })
  })

  const tripId = await bareTrip(page)
  await page.goto(`/trips/${tripId}/plan`)
  await page.getByRole('button', { name: 'Calcola il piano' }).click()

  await expect(page.getByText(/sto chiedendo a openstreetmap.*tokyo/i)).toBeVisible()
  release()
  await expect(page.getByText(/li ho trovati io, a Tokyo/i)).toBeVisible()
  // And stops saying it: the whole panel is replaced by the preview, so a
  // message about a wait that is over cannot linger.
  await expect(page.getByText(/sto chiedendo a openstreetmap/i)).toBeHidden()
})

test('a city the service will not answer for does not take the others down', async ({ page }) => {
  // One instance answering and one refusing is the ordinary state of the
  // world. What came back is still a better plan than none — and the
  // screen has to say which city it drew a blank on, or those days are
  // quietly left empty with no reason given.
  await page.route('**/api/geo/discover**', (route) => {
    const lat = Number(new URL(route.request().url()).searchParams.get('lat'))
    // Kyoto is at 34.99, Tokyo at 35.69. Kyoto's request *fails* rather
    // than coming back empty, because that is what an Overpass instance
    // refusing looks like from here — and it is the case that decides
    // whether one city's bad luck takes the whole search with it.
    if (lat < 35.2) {
      return route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'lookup_unavailable', message: 'busy' } }),
      })
    }
    return route.fulfill({ json: AROUND_TOKYO })
  })

  const day = (offset: number) => {
    const d = new Date()
    d.setDate(d.getDate() + offset)
    return d.toISOString().slice(0, 10)
  }
  const trip = await (
    await page.request.post('/api/trips', {
      data: {
        title: 'Giappone due città',
        start_date: day(30),
        end_date: day(35),
        primary_tz: 'Europe/Rome',
        primary_currency: 'EUR',
        status: 'planned',
      },
    })
  ).json()
  // Both with dates, or the second city is given no days, produces no gap
  // and is never asked about — which is how the first version of this
  // test passed while exercising one city.
  for (const [name, lat, lon, from, to] of [
    ['Tokyo', 35.6896, 139.7006, day(30), day(32)],
    ['Kyoto', 34.9858, 135.7588, day(32), day(35)],
  ] as const) {
    await page.request.post(`/api/trips/${trip.id}/stops`, {
      data: { name, tz: 'Asia/Tokyo', country_code: 'JP', lat, lon, arrive_date: from, depart_date: to },
    })
  }

  await page.goto(`/trips/${trip.id}/plan`)
  await page.getByRole('button', { name: 'Calcola il piano' }).click()

  // Tokyo's answer survived Kyoto's silence.
  await expect(page.getByText(/li ho trovati io/i)).toBeVisible()
  await expect(page.getByText('Sensō-ji')).toBeVisible()
  // And Kyoto's silence is named rather than swallowed.
  await expect(page.getByText(/a Kyoto non ho ricevuto risposta/i)).toBeVisible()
})

test('a proposal says what it is and shows it', async ({ page }) => {
  // "I found places thanks to the suggestions but I don't know what they
  // are." A name and a category could be a national treasure or a shed.
  await page.route('**/api/geo/discover**', (route) => route.fulfill({ json: AROUND_TOKYO }))
  // The photograph itself is intercepted: what is tested is that the app
  // asks for one at a size it can afford, not Wikimedia's uptime.
  await page.route('**/commons.wikimedia.org/**', (route) =>
    route.fulfill({ contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAAAAACw=', 'base64') }),
  )

  const tripId = await bareTrip(page)
  await page.goto(`/trips/${tripId}/plan`)
  await page.getByRole('button', { name: 'Calcola il piano' }).click()

  await expect(page.getByText('tempio buddhista ad Asakusa, Tokyo')).toBeVisible()

  const photo = page.locator('.suggest__photo').first()
  await expect(photo).toBeVisible()
  // Sized in the URL. P18 gives the original — four megabytes for the
  // Tokyo National Museum — and twenty of those is not a list, it is a
  // download.
  await expect(photo).toHaveAttribute('src', /width=320/)
  // And only what has been scrolled to.
  await expect(photo).toHaveAttribute('loading', 'lazy')
})

test('it asks for the descriptions in the language being read', async ({ page }) => {
  const asked: string[] = []
  await page.route('**/api/geo/discover**', (route) => {
    asked.push(new URL(route.request().url()).searchParams.get('lang') ?? '')
    return route.fulfill({ json: AROUND_TOKYO })
  })

  const tripId = await bareTrip(page)
  await page.goto(`/trips/${tripId}/plan`)
  await page.getByRole('button', { name: 'Calcola il piano' }).click()
  await expect(page.getByText(/li ho trovati io/i)).toBeVisible()

  expect(asked).toEqual(['it'])
})
