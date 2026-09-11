import { useState, type FormEvent } from 'react'

import { useCreatePlace, useResolveMapsLink } from '../api/trips'
import { count, t } from '../i18n'
import { linksIn, shortenLink } from '../lib/share'

/**
 * Paste links shared from Google Maps and get places out of them.
 *
 * The way you actually collect places while planning: you find somewhere
 * in Maps, tap Share, paste. Typing a name and then hunting for its
 * coordinates is the part nobody ever does, which is why so many saved
 * places end up with no position at all.
 *
 * A textarea rather than a single-line field, because planning happens
 * in batches: you end an evening with eleven links in a note and want
 * them all in at once. On the phone there is a better way still — share
 * straight into the app from Maps — but that only exists on a device
 * where the app is installed.
 */
export function AddPlaceFromLink({ tripId, onDone }: { tripId: string; onDone: () => void }) {
  const resolve = useResolveMapsLink()
  const create = useCreatePlace(tripId)
  const [text, setText] = useState('')
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [failed, setFailed] = useState<string[]>([])
  const [noPosition, setNoPosition] = useState(0)

  const links = linksIn(text)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (links.length === 0) return

    setFailed([])
    setNoPosition(0)
    setProgress({ done: 0, total: links.length })
    let blind = 0
    const missed: string[] = []

    // One at a time: each link is a redirect the server has to follow,
    // and a dozen at once against an instance that may still be waking
    // is a dozen timeouts rather than a dozen places.
    for (const [index, link] of links.entries()) {
      try {
        const found = await resolve.mutateAsync(link)
        await create.mutateAsync({
          name: found.name ?? shortenLink(link),
          category: 'sight',
          priority: 'normal',
          visit_minutes: 60,
          lat: found.lat,
          lon: found.lon,
          url: found.url,
        })
        if (found.lat === null) blind += 1
      } catch {
        // One bad link must not throw away the ten good ones after it.
        missed.push(shortenLink(link))
      }
      setProgress({ done: index + 1, total: links.length })
    }

    setProgress(null)
    setFailed(missed)
    setNoPosition(blind)
    if (missed.length === 0) {
      setText('')
      if (blind === 0) onDone()
    }
  }

  const busy = progress !== null

  return (
    <form className="card stack" onSubmit={(event) => void onSubmit(event)}>
      <label className="field">
        <span className="field__label">{t('maps.fromLink')}</span>
        <textarea
          className="field__input"
          rows={3}
          placeholder={t('maps.paste')}
          value={text}
          onChange={(event) => setText(event.target.value)}
          autoFocus
        />
      </label>

      {links.length > 1 && <p className="muted small">{count('maps.linksFound', links.length)}</p>}

      {failed.length > 0 && (
        <p className="field__error" role="alert">
          {t('maps.someFailed', { names: failed.join(', ') })}
        </p>
      )}
      {noPosition > 0 && <p className="hint">{count('maps.someWithoutPosition', noPosition)}</p>}

      <div className="row row--end">
        <button type="button" className="button button--quiet" onClick={onDone}>
          {t('common.cancel')}
        </button>
        <button className="button" type="submit" disabled={busy || links.length === 0}>
          {busy
            ? t('maps.resolving', { done: progress.done, total: progress.total })
            : t('maps.add')}
        </button>
      </div>
    </form>
  )
}
