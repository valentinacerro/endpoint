import { defineConfig, devices } from '@playwright/test'

/**
 * The only test that drives the real thing.
 *
 * Everything else in this repository tests a function or a component. This
 * starts the actual server, serving the actual built app, and walks the
 * path a person walks on their first evening — sign in, say where you are
 * going, collect somewhere to see, have it put on a day.
 *
 * The server is started by Playwright with its own throwaway database, so
 * a run leaves nothing behind and never touches dev.db.
 */

const PORT = 8911

export default defineConfig({
  testDir: './e2e',
  // Everything here shares one server and one database, and the whole
  // point is the order things happen in.
  workers: 1,
  fullyParallel: false,
  // A cold start behind a free instance is the app's own problem; this
  // server is local, so anything slow is a real failure.
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: process.env.CI ? 'line' : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // A phone, because that is what this app is.
    ...devices['Pixel 7'],
    // The app detects the language from the browser and the emulated
    // device reports en-US, so without this the walk happens in English
    // while the assertions are in the language she reads it in.
    locale: 'it-IT',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `python3 e2e/server.py ${PORT}`,
    url: `http://127.0.0.1:${PORT}/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
