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

const PASSWORD = 'walkthrough'

async function signIn(page: Page) {
  await page.goto('/')
  await page.getByLabel(/password/i).fill(PASSWORD)
  await page.getByRole('button', { name: 'Entra' }).click()
  // Waited for: without it the seed below runs before the cookie is set,
  // 401s, and the test walks an empty screen that proves nothing.
  await expect(page.getByRole('link', { name: 'Tutti i viaggi' }).first()).toBeVisible()
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
    await signIn(page)
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
    await signIn(page)
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
