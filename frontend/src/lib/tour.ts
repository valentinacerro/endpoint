/**
 * The short walk round the app, and whether it has been taken.
 *
 * This is the first "seen" flag in the whole codebase, and that is worth
 * saying out loud. `OfflineReminder`, `UpdatePrompt` and `SyncBanner` all
 * derive their visibility from a real condition and disappear when it
 * stops being true — deliberately, so that nothing has to remember what
 * you have already been shown. A tour cannot work that way: the condition
 * it responds to is "you have not seen this", which exists nowhere but in
 * the record of having seen it.
 *
 * So it is one boolean in localStorage, next to the language. If storage
 * is unavailable the tour simply offers itself again, which is a far
 * better failure than never appearing.
 *
 * driver.js is loaded only when the tour actually runs: 25 KB of script
 * and 3 KB of CSS that most sessions never need, handled the same way as
 * Leaflet and pdf.js.
 */

import { t } from '../i18n'

const STORAGE_KEY = 'endpoint.tourSeen'

export function hasSeenTour(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'yes'
  } catch {
    // Private browsing, or storage disabled. Offering the tour again is
    // the harmless direction to be wrong in.
    return false
  }
}

export function rememberTourSeen(): void {
  try {
    localStorage.setItem(STORAGE_KEY, 'yes')
  } catch {
    // Nothing to do: the tour will offer itself next time.
  }
}

/**
 * A step whose element is missing is dropped rather than shown floating.
 *
 * Every one of these points at something conditional — the planner row
 * only exists while places are waiting for a day — and driver.js centres
 * a step whose selector matches nothing, which reads as a bug.
 */
interface Step {
  element: string
  title: string
  description: string
}

function steps(): Step[] {
  return [
    {
      element: '.tabs',
      title: t('tour.tabs.title'),
      description: t('tour.tabs.body'),
    },
    {
      element: '.prompt',
      title: t('tour.plan.title'),
      description: t('tour.plan.body'),
    },
    {
      element: '.day__optimise',
      title: t('tour.day.title'),
      description: t('tour.day.body'),
    },
    {
      element: '.appbar__action',
      title: t('tour.search.title'),
      description: t('tour.search.body'),
    },
  ]
}

export async function runTour(): Promise<void> {
  const present = steps().filter((step) => document.querySelector(step.element))
  if (present.length === 0) return

  const [{ driver }] = await Promise.all([
    import('driver.js'),
    import('driver.js/dist/driver.css'),
  ])

  driver({
    showProgress: present.length > 1,
    allowClose: true,
    progressText: t('tour.progress'),
    nextBtnText: t('tour.next'),
    prevBtnText: t('tour.back'),
    doneBtnText: t('tour.done'),
    steps: present.map((step) => ({
      element: step.element,
      popover: { title: step.title, description: step.description },
    })),
    onDestroyed: rememberTourSeen,
  }).drive()
}
