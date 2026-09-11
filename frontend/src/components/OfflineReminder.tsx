import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import { attachmentUrl } from '../api/trips'
import type { TripBundle } from '../api/types'
import { count, t } from '../i18n'
import { daysUntil } from '../lib/datetime'
import { pinnedUrls } from '../offline/attachmentCache'

/** How early to start nagging. */
const WINDOW_DAYS = 3

/**
 * A nudge in the last days before departure, if documents are still missing
 * from the phone.
 *
 * Deliberately not shown earlier: a reminder that appears for six weeks is
 * one you stop seeing. It also disappears the moment everything is cached,
 * so it never becomes decoration.
 */
export function OfflineReminder({ bundle, tripId }: { bundle: TripBundle; tripId: string }) {
  const [missing, setMissing] = useState(0)

  const start = bundle.trip.start_date
  const days = start ? daysUntil(start) : null
  const inWindow = days !== null && days >= 0 && days <= WINDOW_DAYS

  useEffect(() => {
    if (!inWindow || bundle.attachments.length === 0) return
    let cancelled = false

    void pinnedUrls().then((pinned) => {
      if (cancelled) return
      const absent = bundle.attachments.filter(
        (item) => !pinned.has(attachmentUrl(tripId, item.id)),
      )
      setMissing(absent.length)
    })

    return () => {
      cancelled = true
    }
  }, [inWindow, bundle.attachments, tripId])

  if (!inWindow || missing === 0) return null

  return (
    <section className="card remind">
      <div className="stack stack--tight">
        <strong>{count('offline.remindTitle', days ?? 0)}</strong>
        <span className="muted">{count('offline.remindBody', missing)}</span>
      </div>
      <Link className="button button--small" to={`/trips/${tripId}/offline`}>
        {t('offline.remindAction')}
      </Link>
    </section>
  )
}
