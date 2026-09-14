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

const AROUND_TOKYO = [
  { name: 'Sensō-ji', lat: 35.7148, lon: 139.7967, category: 'temple', fame: 90, wikidata: 'Q206144', osm_id: 'w/1' },
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

  await expect.poll(async () => {
    const places = await page.request.get(`/api/trips/${tripId}/places`).then((r) => r.json())
    return places.filter((p: { planned_start_at: string | null }) => p.planned_start_at).length
  }, { timeout: 15_000 }).toBeGreaterThan(0)

  const places = await page.request.get(`/api/trips/${tripId}/places`).then((r) => r.json())
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
  await expect.poll(async () =>
    (await page.request.get(`/api/trips/${tripId}/places`).then((r) => r.json())).length,
  { timeout: 15_000 }).toBeGreaterThan(0)

  const names = (await page.request.get(`/api/trips/${tripId}/places`).then((r) => r.json()))
    .map((p: { name: string }) => p.name)
  expect(names).not.toContain('Sensō-ji')
})
