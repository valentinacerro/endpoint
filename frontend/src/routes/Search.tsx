import { useState } from 'react'
import { Link, useParams } from 'react-router'

import { useTripBundle } from '../api/trips'
import { AppBar } from '../components/AppBar'
import { count, t } from '../i18n'
import { searchKindLabel } from '../i18n/labels'
import { search } from '../lib/search'

/** Enough results to scroll through, not enough to scroll past. */
const SHOWN = 40

/**
 * Search across the whole trip.
 *
 * Reads only the cached bundle, so it answers in a basement with no
 * signal — which is exactly where you are standing when you need the
 * confirmation code. There is no debounce because there is no request:
 * three hundred records are scanned faster than the next keystroke.
 */
export function Search() {
  const { tripId } = useParams<{ tripId: string }>()
  const bundle = useTripBundle(tripId)
  const [query, setQuery] = useState('')

  if (bundle.isPending) return <main className="page">{t('common.loading')}</main>
  if (!bundle.data || !tripId) return <main className="page">{t('common.error')}</main>

  const results = search(bundle.data, query)
  const asked = query.trim().length > 0

  return (
    <>
      <AppBar title={t('search.title')} subtitle={bundle.data.trip.title} back={`/trips/${tripId}`} />
      <main className="page stack">
        <label className="field">
          <span className="field__label">{t('search.label')}</span>
          <input
            className="field__input"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('search.placeholder')}
            autoFocus
            // Off on all four: a place name is not a word the keyboard
            // knows, and being corrected to one mid-search is maddening.
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
        </label>

        {!asked && <p className="muted small">{t('search.hint')}</p>}
        {asked && results.length === 0 && <p className="empty">{t('search.none')}</p>}

        {results.length > 0 && (
          <ul className="rows">
            {results.slice(0, SHOWN).map((result) => (
              <li key={`${result.kind}:${result.id}`}>
                <Link className="rows__item" to={result.to}>
                  <span className="rows__body">
                    <span className="rows__title">{result.title}</span>
                    <span className="rows__hint">
                      {searchKindLabel(result.kind)}
                      {result.detail ? ` · ${result.detail}` : ''}
                    </span>
                  </span>
                  <span className="rows__chevron" aria-hidden="true">
                    ›
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {results.length > SHOWN && (
          <p className="muted small">{count('search.more', results.length - SHOWN)}</p>
        )}
      </main>
    </>
  )
}
