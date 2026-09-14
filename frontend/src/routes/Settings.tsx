import { Link, useNavigate } from 'react-router'

import { AppBar } from '../components/AppBar'
import { runTour } from '../lib/tour'
import { LOCALE_NAMES, LOCALES, setLocale, t, useLocale } from '../i18n'

/**
 * The few things that belong to the app rather than to a trip.
 *
 * Today that is the language. The choice is remembered in the browser,
 * not on the server: it is about this device, and syncing it would mean
 * a phone set to English changing the laptop out from under you.
 */
export function Settings() {
  const locale = useLocale()
  const navigate = useNavigate()

  /**
   * The tour points at the itinerary, which is not this screen.
   *
   * So it goes there first and starts once the timeline has drawn.
   * Without the wait every step's element is missing and driver.js
   * centres an unanchored popover, which reads as a bug.
   */
  function replay() {
    navigate(-1)
    requestAnimationFrame(() => window.setTimeout(() => void runTour(), 250))
  }

  return (
    <>
      <AppBar title={t('settings.title')} back="/" />
      <main className="page stack">
        <section className="card stack stack--tight">
          <span className="detail__label">{t('settings.language')}</span>
          <div className="row">
            {LOCALES.map((option) => (
              <button
                key={option}
                className={`chip ${option === locale ? 'chip--on' : ''}`}
                aria-pressed={option === locale}
                onClick={() => setLocale(option)}
              >
                {LOCALE_NAMES[option]}
              </button>
            ))}
          </div>
          <p className="muted small">{t('settings.languageHint')}</p>
        </section>

        <section className="card stack stack--tight">
          <span className="detail__label">{t('tour.replay')}</span>
          <p className="muted small">{t('tour.replayHint')}</p>
          <div className="row row--end">
            <button className="button button--quiet button--small" onClick={replay}>
              {t('tour.start')}
            </button>
          </div>
        </section>

        <Link className="button button--quiet" to="/">
          {t('common.back')}
        </Link>
      </main>
    </>
  )
}
