import { useState, type FormEvent } from 'react'

import { ApiError } from '../api/client'
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
/** What the server said was wrong, in words meant for a person. */
function reasonFor(error: unknown): string {
  const code = error instanceof ApiError ? error.code : ''
  const known: Record<string, string> = {
    not_a_maps_link: t('maps.error.not_a_maps_link'),
    nothing_in_link: t('maps.error.nothing_in_link'),
    link_unreachable: t('maps.error.link_unreachable'),
  }
  return known[code] ?? t('maps.error.generic')
}

export function AddPlaceFromLink({
  tripId,
  near,
  onDone,
}: {
  tripId: string
  /** Where the trip is, so a name-only link is placed in the right city. */
  near: { lat: number; lon: number } | null
  onDone: () => void
}) {
  const resolve = useResolveMapsLink()
  const create = useCreatePlace(tripId)
  const [text, setText] = useState('')
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [failed, setFailed] = useState<{ name: string; why: string }[]>([])
  const [noPosition, setNoPosition] = useState(0)
  const [estimated, setEstimated] = useState(0)

  const links = linksIn(text)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (links.length === 0) return

    setFailed([])
    setNoPosition(0)
    setEstimated(0)
    setProgress({ done: 0, total: links.length })
    let blind = 0
    let guessed = 0
    const missed: { name: string; why: string }[] = []

    // One at a time: each link is a redirect the server has to follow,
    // and a dozen at once against an instance that may still be waking
    // is a dozen timeouts rather than a dozen places.
    for (const [index, link] of links.entries()) {
      try {
        const found = await resolve.mutateAsync({ url: link, near })
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
        else if (found.position === 'geocoded') guessed += 1
      } catch (error) {
        // One bad link must not throw away the ten good ones after it —
        // and it should say what was wrong with it, not merely that
        // something was. The server distinguishes "that is not a Maps
        // link" from "that link could not be opened", and those call for
        // different things from the reader.
        missed.push({ name: shortenLink(link), why: reasonFor(error) })
      }
      setProgress({ done: index + 1, total: links.length })
    }

    setProgress(null)
    setFailed(missed)
    setNoPosition(blind)
    setEstimated(guessed)
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

      {/* A disabled button with no explanation is the worst of both: the
          commonest cause is a link copied without its https:// prefix. */}
      {text.trim() !== '' && links.length === 0 && <p className="hint">{t('maps.noLinkFound')}</p>}

      {failed.length > 0 && (
        <div className="stack stack--tight" role="alert">
          {failed.map((miss) => (
            <p key={miss.name} className="field__error">
              {t('maps.oneFailed', { name: miss.name, why: miss.why })}
            </p>
          ))}
        </div>
      )}
      {estimated > 0 && <p className="hint">{count('maps.someEstimated', estimated)}</p>}
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
