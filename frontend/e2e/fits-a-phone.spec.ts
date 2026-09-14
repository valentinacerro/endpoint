import { expect, test, type Page } from '@playwright/test'

import { seedTrip } from './seed'

/**
 * Every screen, on the narrowest phone still in use.
 *
 * This app is used on a phone and nowhere else, so a screen that scrolls
 * sideways or clips a name is not a cosmetic problem — it is the app
 * failing at its one job while every unit test stays green. Nothing else
 * here would notice: the component tests render into a jsdom with no
 * width at all.
 *
 * 320 CSS pixels is the floor: an iPhone SE, and the narrowest Android
 * still sold. If it survives that it survives everything.
 */

const NARROW = { width: 320, height: 680 }

async function signIn(page: Page) {
  await page.goto('/')
  await page.getByLabel(/password/i).fill('walkthrough')
  await page.getByRole('button', { name: 'Entra' }).click()
  await expect(page.getByRole('link', { name: 'Tutti i viaggi' }).first()).toBeVisible()
}

/** Anything sticking out past the right edge, named so it can be found. */
async function overflowing(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth
    const guilty: string[] = []
    for (const element of document.querySelectorAll<HTMLElement>('body *')) {
      const box = element.getBoundingClientRect()
      if (box.width === 0 && box.height === 0) continue
      // Two pixels of slack: a rounded border can land on a half pixel.
      if (box.right > width + 2 || box.left < -2) {
        const name =
          element.tagName.toLowerCase() +
          (element.className && typeof element.className === 'string'
            ? '.' + element.className.trim().split(/\s+/).join('.')
            : '')
        const text = (element.textContent ?? '').trim().slice(0, 40)
        guilty.push(`${name} [${Math.round(box.left)}…${Math.round(box.right)}] ${text}`)
      }
    }
    // The innermost offender is the real one; its parents are dragged out
    // by it and would bury the cause in noise.
    return guilty.slice(0, 6)
  })
}

test.describe.configure({ mode: 'serial' })

test.use({ viewport: NARROW })

test('every screen fits a 320px phone', async ({ page }) => {
  await signIn(page)
  // `page.request`, not the `request` fixture: that one has its own
  // cookie jar, so the seed came back 401 and this test walked seven
  // empty screens and passed. An empty screen fits any width.
  const tripId = await seedTrip(page.request)

  const screens: [string, string][] = [
    ['home', '/'],
    ['trips', '/trips'],
    ['itinerary', `/trips/${tripId}`],
    ['places', `/trips/${tripId}/places`],
    ['money', `/trips/${tripId}/expenses`],
    ['more', `/trips/${tripId}/more`],
    ['plan', `/trips/${tripId}/plan`],
    ['stops', `/trips/${tripId}/stops`],
    ['packing', `/trips/${tripId}/packing`],
    ['weather', `/trips/${tripId}/weather`],
    ['diary', `/trips/${tripId}/diary`],
    ['print', `/trips/${tripId}/print`],
    ['offline', `/trips/${tripId}/offline`],
    ['settings', '/settings'],
  ]

  const broken: string[] = []
  for (const [name, path] of screens) {
    await page.goto(path)
    // Long enough for the bundle to arrive and the lists to draw.
    await page.waitForTimeout(400)

    const scrolls = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    )
    const guilty = await overflowing(page)
    if (scrolls || guilty.length > 0) {
      broken.push(`${name} (${path})\n    ` + guilty.join('\n    '))
    }
  }

  expect(broken, `screens that do not fit 320px:\n\n${broken.join('\n\n')}`).toEqual([])
})
