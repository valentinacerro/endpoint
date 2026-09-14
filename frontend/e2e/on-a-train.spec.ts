import { expect, test, type Page } from '@playwright/test'

import { seedTrip } from './seed'

/**
 * Adding something with no network at all.
 *
 * The claim this app makes is that it works on the Yamanote line, and
 * until now that claim covered ticking the packing list and recording a
 * coffee — but not adding a place, which is the thing you actually do on
 * a train. Adding one was a POST, and a POST cannot be queued: the server
 * names the row, so replaying a request whose reply was lost produces a
 * second copy.
 *
 * This is the only test that proves the whole path rather than a link in
 * it: the form, the request failing for real, the write landing in
 * IndexedDB, the row appearing anyway, and the server having it once the
 * network comes back.
 */

/** Signed in already, once for the whole run: see `signed-in.setup.ts`. */

/**
 * Wait until the service worker is the one answering.
 *
 * Any navigation made with the network off is served by it and by nothing
 * else. On a phone it has been in control since the first visit; in a
 * fresh browser context it may not be yet, and a test that cuts the line
 * first is testing Chrome's registration timing rather than the app.
 */
async function serviceWorkerReady(page: Page): Promise<void> {
  await page.evaluate(() => navigator.serviceWorker.ready)
}

/** Its own trip, so this file does not depend on another having run. */
async function openThePlaces(page: Page): Promise<string> {
  // `page.request`, not the `request` fixture: that one has its own cookie
  // jar, and a seed that 401s leaves an empty screen that proves nothing.
  const tripId = await seedTrip(page.request)
  await page.goto(`/trips/${tripId}/places`)
  await expect(page.getByRole('button', { name: /aggiungi luogo/i })).toBeVisible()
  return tripId
}

test.describe.serial('with no network', () => {
  test('a place added in a tunnel is on the screen, and on the server later', async ({
    page,
    context,
  }) => {
    const tripId = await openThePlaces(page)

    // Into the tunnel. Not a stubbed route: the browser is actually
    // offline, so `apiFetch` fails the way it fails on the Yamanote line.
    await context.setOffline(true)

    await page.getByRole('button', { name: /aggiungi luogo/i }).click()
    await page.getByLabel(/nome/i).first().fill('Golden Gai')
    await page.getByRole('button', { name: /^salva$/i }).click()

    // On the screen straight away, with no network anywhere.
    await expect(page.getByText('Golden Gai')).toBeVisible()

    // And the app says so, rather than pretending everything is normal.
    await expect(page.getByText(/modific(a|he) da inviare/i).first()).toBeVisible()

    // Out of the tunnel. The queue drains on the browser's own "online".
    await context.setOffline(false)
    await page.reload()

    await expect(page.getByText('Golden Gai')).toBeVisible()

    // The real check: it is on the server, exactly once — not on a screen
    // drawn from a cache that still believes its own optimism.
    const places = await page.request.get(`/api/trips/${tripId}/places`).then((r) => r.json())
    expect(places.filter((place: { name: string }) => place.name === 'Golden Gai')).toHaveLength(1)
  })

  test('a place added and then dropped before surfacing never reaches the server', async ({
    page,
    context,
  }) => {
    // Both writes are in the queue at once, and the second cancels the
    // first. Sending them would ask the server to delete a place it was
    // never told about, which it would refuse — and the queue would
    // report a failure for a place that correctly does not exist.
    const tripId = await openThePlaces(page)

    // Watched, because this is the only place the difference shows. With
    // the cancellation the queue sends nothing; without it, it sends a
    // deletion, is told there is no such place, and drops it — and the
    // list ends up looking identical either way.
    const sent: string[] = []
    page.on('request', (request) => {
      if (request.method() !== 'GET' && request.url().includes('/places/')) {
        sent.push(request.method())
      }
    })

    await context.setOffline(true)

    await page.getByRole('button', { name: /aggiungi luogo/i }).click()
    await page.getByLabel(/nome/i).first().fill('Omoide Yokocho')
    await page.getByRole('button', { name: /^salva$/i }).click()
    await expect(page.getByText('Omoide Yokocho')).toBeVisible()

    page.once('dialog', (dialog) => dialog.accept())
    await page
      .locator('.doc', { hasText: 'Omoide Yokocho' })
      .getByRole('button', { name: /^elimina$/i })
      .click()
    await expect(page.getByText('Omoide Yokocho')).toBeHidden()

    // From here on, only what the queue chooses to send counts. The two
    // attempts made while offline are how a write discovers it must wait.
    sent.length = 0
    await context.setOffline(false)
    await page.reload()

    await expect(page.getByText('Omoide Yokocho')).toBeHidden()
    const places = await page.request.get(`/api/trips/${tripId}/places`).then((r) => r.json())
    expect(places.map((place: { name: string }) => place.name)).not.toContain('Omoide Yokocho')

    // Nothing was sent about it at all: not the create, and above all not
    // a deletion of something that was never there.
    expect(sent).toEqual([])
  })
})

test.describe.serial('a document with no network', () => {
  /**
   * Just enough to sniff as a PDF. The server decides a file's type from
   * its first bytes and not from what the browser claims, so `%PDF` alone
   * is refused with a 415 — the hyphen is part of the signature.
   */
  const VOUCHER = {
    name: 'voucher.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n'),
  }

  test('a file attached in a hotel with no wifi is still there in the morning', async ({
    page,
    context,
  }) => {
    // The one queued write whose payload is not JSON. A `FormData` cannot
    // be stored in IndexedDB, so the file and its fields are kept apart
    // and the multipart body is rebuilt when it is finally sent — and
    // whether a `File` really survives IndexedDB is a question only a
    // real browser can answer, which is why this test reloads the page
    // before letting the queue drain.
    const tripId = await seedTrip(page.request)
    const bookings = await page.request
      .get(`/api/trips/${tripId}/bookings`)
      .then((r) => r.json())
    const hotel = bookings.find((booking: { kind: string }) => booking.kind === 'hotel')
    await page.goto(`/trips/${tripId}/bookings/${hotel.id}`)
    await expect(page.getByRole('button', { name: /allega documento/i })).toBeVisible()
    // The reload below happens with the network off, so the service
    // worker has to be the one answering it. Waiting for it to take
    // control is the difference between testing the queue and testing
    // whether Chrome had got round to registering a worker yet.
    await serviceWorkerReady(page)

    await context.setOffline(true)
    await page.setInputFiles('input[type=file]', VOUCHER)

    // Named, sized, and honest about not being anywhere yet: there is no
    // file at its address to open, pin, or delete.
    await expect(page.getByText('voucher.pdf')).toBeVisible()
    await expect(page.getByText(/in attesa di rete/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /salva offline/i })).toBeHidden()

    // Closed and reopened while still offline: the bytes have to have
    // reached IndexedDB, not merely a variable. What is checked is the
    // queue rather than the row — the row is drawn from the persisted
    // query cache, which is written on a throttle and may not have caught
    // up, while the write itself goes to the store at once.
    await page.reload()
    await expect(page.getByText(/modific(a|he) da inviare/i).first()).toBeVisible()

    await context.setOffline(false)
    await page.reload()

    const attachments = await page.request
      .get(`/api/trips/${tripId}/attachments`)
      .then((r) => r.json())
    const sent = attachments.filter((one: { filename: string }) => one.filename === 'voucher.pdf')
    expect(sent).toHaveLength(1)
    expect(sent[0].byte_size).toBe(9)

    // And the real one has replaced the stand-in, with the controls back.
    await expect(page.getByText(/in attesa di rete/i)).toBeHidden()
    await expect(page.getByRole('button', { name: /salva offline/i })).toBeVisible()
  })

  test('is not counted among the documents to save until it is on the server', async ({
    page,
    context,
  }) => {
    // The offline screen exists to get every document onto the phone
    // before departure. A document still in the write queue is on the
    // phone already, and at no address the server would answer, so
    // offering to download it would be offering to download nothing.
    const tripId = await seedTrip(page.request)
    const bookings = await page.request
      .get(`/api/trips/${tripId}/bookings`)
      .then((r) => r.json())
    const hotel = bookings.find((booking: { kind: string }) => booking.kind === 'hotel')

    await page.goto(`/trips/${tripId}/offline`)
    await expect(page.getByText(/documenti/i).first()).toBeVisible()
    const before = await page.locator('.doc').count()

    await page.goto(`/trips/${tripId}/bookings/${hotel.id}`)
    await expect(page.getByRole('button', { name: /allega documento/i })).toBeVisible()
    // The navigation below happens with the network off.
    await serviceWorkerReady(page)
    await context.setOffline(true)
    await page.setInputFiles('input[type=file]', VOUCHER)
    await expect(page.getByText(/in attesa di rete/i)).toBeVisible()

    await page.goto(`/trips/${tripId}/offline`)
    expect(await page.locator('.doc').count()).toBe(before)
  })
})

test.describe.serial('a trip started with no network', () => {
  test('is on the list at once, and on the server when there is a signal', async ({
    page,
    context,
  }) => {
    // The least likely of these to happen — a trip is planned at a kitchen
    // table — but it is the write everything else hangs off, and a queue
    // with a hole in it is a queue nobody can trust. The trip is named by
    // the phone when the form opens, which is what makes it queueable and
    // what lets the first stop be addressed before the server has replied.
    await page.goto('/trips')
    // Waited for before the network goes: `goto` resolves on load, while
    // the trip list is still on its way.
    const start = page.getByRole('button', { name: /nuovo viaggio/i })
    await expect(start).toBeVisible()
    await context.setOffline(true)

    await start.click()
    await page.getByLabel(/dove vai/i).fill('Lisbona')
    await page.getByRole('button', { name: /^salva$/i }).click()

    // Straight into the trip it just made, at the id it chose itself.
    await expect(page).toHaveURL(/\/trips\/[0-9a-f-]{36}$/)
    const tripId = page.url().split('/').pop()!
    await expect(page.getByText(/modific(a|he) da inviare/i).first()).toBeVisible()

    await context.setOffline(false)
    await page.reload()

    const trip = await page.request.get(`/api/trips/${tripId}`)
    expect(trip.status()).toBe(200)
    expect((await trip.json()).title).toBe('Lisbona')
  })
})

test.describe.serial('a plan applied with no network', () => {
  test('rearranges the days at once and reaches the server later', async ({ page, context }) => {
    // Thirty visits in one request, and the one queued write that is a
    // POST: it is idempotent anyway, because it names every place it
    // moves and gives each an absolute time, so replaying it in a tunnel
    // leaves the same itinerary rather than a second copy of one.
    const tripId = await seedTrip(page.request)
    await page.goto(`/trips/${tripId}/plan`)
    // Waited for before the network goes: `goto` resolves on load, while
    // the bundle is still on its way, and cutting the line in between
    // leaves the screen with no trip to plan and no button to press.
    const compute = page.getByRole('button', { name: 'Calcola il piano' })
    await expect(compute).toBeVisible()

    await context.setOffline(true)
    await compute.click()

    const apply = page.getByRole('button', { name: /^applica$/i })
    await expect(apply).toBeVisible()
    await apply.click()

    // No error, and a count: the plan was queued and the screen was told
    // what it would have been told by the server.
    //
    // Then the itinerary itself, still with the network off. Online the
    // re-read after applying papers over anything the optimistic patch
    // forgot; offline there is no re-read, so this is the only place that
    // can prove the places the plan brought with it actually arrive on
    // the screen rather than having their times applied to rows nobody
    // ever added.
    await expect(page.getByText(/il server l’ha rifiutato/i)).toBeHidden()
    await expect(page.getByText(/applicat[ae] .* visit[ae]\.|applicata una visita\./i)).toBeVisible()
    await expect(page.getByText(/modific(a|he) da inviare/i).first()).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/trips/${tripId}$`))
    await expect(page.locator('.day').first()).toBeVisible()

    await context.setOffline(false)
    await page.reload()

    const places = await page.request.get(`/api/trips/${tripId}/places`).then((r) => r.json())
    const scheduled = places.filter((place: { planned_start_at: string | null }) =>
      Boolean(place.planned_start_at),
    )
    expect(scheduled.length).toBeGreaterThan(0)
    // And every one of them carries the zone its day is in, never the
    // phone's — the trap that put bookings on the wrong day.
    for (const place of scheduled) expect(place.planned_tz).toBe('Asia/Tokyo')
  })
})

test.describe.serial('a plan made on wifi and applied in a tunnel', () => {
  test('the places it found are on the itinerary before the server has them', async ({
    page,
    context,
  }) => {
    // The only sequence in which this can be seen, and a real one: the
    // search needs a network, so the plan is computed at the hotel; the
    // applying happens on the train. Online, the re-read after applying
    // hides anything the optimistic patch forgets. Here there is no
    // re-read, and the places the plan is carrying exist nowhere but in
    // the request sitting in the queue.
    await page.route('**/api/geo/discover**', (route) =>
      route.fulfill({
        json: [
          { name: 'Sensō-ji', lat: 35.7148, lon: 139.7967, category: 'temple', fame: 90, wikidata: 'Q206144', osm_id: 'w/1' },
          { name: 'Ueno Park', lat: 35.7141, lon: 139.7744, category: 'park', fame: 70, wikidata: null, osm_id: 'w/2' },
          { name: 'Meiji Jingū', lat: 35.6764, lon: 139.6993, category: 'shrine', fame: 85, wikidata: 'Q383981', osm_id: 'w/3' },
        ],
      }),
    )

    const day = (offset: number) => {
      const d = new Date()
      d.setDate(d.getDate() + offset)
      return d.toISOString().slice(0, 10)
    }
    const trip = await (
      await page.request.post('/api/trips', {
        data: { title: 'Niente in valigia', start_date: day(30), end_date: day(33),
                primary_tz: 'Europe/Rome', primary_currency: 'EUR', status: 'planned' },
      })
    ).json()
    await page.request.post(`/api/trips/${trip.id}/stops`, {
      data: { name: 'Tokyo', tz: 'Asia/Tokyo', country_code: 'JP', lat: 35.6896, lon: 139.7006,
              arrive_date: day(30), depart_date: day(33) },
    })

    await page.goto(`/trips/${trip.id}/plan`)
    const compute = page.getByRole('button', { name: 'Calcola il piano' })
    await expect(compute).toBeVisible()
    await compute.click()

    const apply = page.getByRole('button', { name: /^applica$/i })
    await expect(apply).toBeVisible()

    // Into the tunnel, between working it out and agreeing to it.
    await context.setOffline(true)
    await apply.click()

    await expect(page).toHaveURL(new RegExp(`/trips/${trip.id}$`))
    // Under a numbered day, not in the pile at the bottom. A place added
    // under an id the times were not applied to still appears on this
    // screen — among the things with no day, which uses the same markup
    // and looks like success until you read the heading.
    await expect(
      page.locator('.day', { has: page.locator('.day__date') }).filter({ hasText: 'Sensō-ji' }),
    ).toHaveCount(1)
    await expect(page.getByText(/modific(a|he) da inviare/i).first()).toBeVisible()
    // Not on the server yet, and the app is not pretending otherwise.
    expect(await page.request.get(`/api/trips/${trip.id}/places`).then((r) => r.json())).toEqual([])

    await context.setOffline(false)
    await page.reload()

    await expect
      .poll(
        async () =>
          (await page.request.get(`/api/trips/${trip.id}/places`).then((r) => r.json())).length,
        { timeout: 20_000 },
      )
      .toBe(3)
  })
})
