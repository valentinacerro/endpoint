import { Link } from 'react-router'

import { AppBar } from '../components/AppBar'
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

        <Link className="button button--quiet" to="/">
          {t('common.back')}
        </Link>
      </main>
    </>
  )
}
