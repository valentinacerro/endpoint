import { useState, type FormEvent } from 'react'

import { useCreatePlace, useResolveMapsLink } from '../api/trips'
import { t } from '../i18n'

/**
 * Paste a link shared from Google Maps and get a place out of it.
 *
 * The way you actually collect places while planning: you find somewhere in
 * Maps, tap Share, paste. Typing a name and then hunting for its
 * coordinates is the part nobody ever does, which is why so many saved
 * places end up with no position at all.
 */
export function AddPlaceFromLink({ tripId, onDone }: { tripId: string; onDone: () => void }) {
  const resolve = useResolveMapsLink()
  const create = useCreatePlace(tripId)
  const [url, setUrl] = useState('')
  const [warning, setWarning] = useState<string | null>(null)

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!url.trim()) return
    setWarning(null)

    resolve.mutate(url.trim(), {
      onSuccess: (found) => {
        if (found.lat === null) setWarning(t('maps.noCoords'))
        create.mutate(
          {
            // A link without a readable name still deserves to be saved;
            // an empty title is easier to fix than a lost place.
            name: found.name ?? t('places.title'),
            category: 'sight',
            priority: 'normal',
            visit_minutes: 60,
            lat: found.lat,
            lon: found.lon,
            url: found.url,
          },
          {
            onSuccess: () => {
              setUrl('')
              if (found.lat !== null) onDone()
            },
          },
        )
      },
    })
  }

  const busy = resolve.isPending || create.isPending
  const errorText = resolve.error
    ? (
        {
          not_a_maps_link: t('maps.error.not_a_maps_link'),
          nothing_in_link: t('maps.error.nothing_in_link'),
          link_unreachable: t('maps.error.link_unreachable'),
        } as Record<string, string>
      )[resolve.error.code] ?? t('maps.error.generic')
    : null

  return (
    <form className="card stack" onSubmit={onSubmit}>
      <label className="field">
        <span className="field__label">{t('maps.fromLink')}</span>
        <input
          className="field__input"
          type="url"
          inputMode="url"
          placeholder={t('maps.paste')}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          autoFocus
        />
      </label>

      {errorText && (
        <p className="field__error" role="alert">
          {errorText}
        </p>
      )}
      {warning && <p className="hint">{warning}</p>}

      <div className="row row--end">
        <button type="button" className="button button--quiet" onClick={onDone}>
          {t('common.cancel')}
        </button>
        <button className="button" type="submit" disabled={busy || !url.trim()}>
          {busy ? t('maps.reading') : t('maps.add')}
        </button>
      </div>
    </form>
  )
}
