import { expect, test as setup } from '@playwright/test'

/**
 * Sign in once, for the whole suite.
 *
 * Not a convenience. Signing in per test crossed the login rate limiter —
 * ten attempts a minute, which is there to make guessing a single
 * password unrewarding — at the thirteenth test, and two specs that had
 * both passed alone began failing together with "element not found" while
 * the screen quietly said "too many attempts". Raising the limit to suit
 * the tests would have been weakening a real defence to keep a habit.
 *
 * `first-evening.spec.ts` still signs in itself, because the first
 * evening is what it is about.
 */

const FILE = 'e2e/.auth/session.json'

setup('sign in once', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel(/password/i).fill('walkthrough')
  await page.getByRole('button', { name: 'Entra' }).click()
  await expect(page.getByRole('link', { name: 'Tutti i viaggi' }).first()).toBeVisible()
  await page.context().storageState({ path: FILE })
})
