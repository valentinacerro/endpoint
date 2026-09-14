import type { PlaceCategory } from '../api/types'
import { t } from '../i18n'
import { placeCategoryLabel } from '../i18n/labels'

/**
 * A suggested place, told well enough to choose from.
 *
 * "I found places thanks to the suggestions of the app but I don't know
 * what they are." Twenty rows reading "Gokokuji · Tempio · 1h 30min" say
 * what kind of thing each is and nothing whatever about which are worth a
 * morning, and choosing eight of twenty on that basis is guessing.
 *
 * Both halves come free with a query already being made: Wikidata knows
 * what a thing is in a sentence, and points at a photograph of it. What
 * is *not* free is the photograph's size — P18 gives the original, four
 * megabytes for the Tokyo National Museum — so the width is asked for in
 * the URL and the browser fetches only what has been scrolled to.
 */
interface Props {
  name: string
  category: PlaceCategory
  description?: string | null
  image?: string | null
  /** Wikipedia editions, where it is known. Zero means "we cannot say". */
  fame?: number
  /** Anything the caller wants on the end of the line: a city, a length. */
  extra?: string | null
}

export function PlaceCard({ name, category, description, image, fame = 0, extra }: Props) {
  return (
    <span className="suggest">
      {image ? (
        <img
          className="suggest__photo"
          src={image}
          alt=""
          loading="lazy"
          decoding="async"
          width={64}
          height={64}
        />
      ) : (
        // A hole rather than a shrug: the row keeps its shape, so a list
        // where half the places have a photograph does not look ragged.
        <span className="suggest__photo suggest__photo--none" aria-hidden="true" />
      )}
      <span className="suggest__body">
        <span className="suggest__name">{name}</span>
        {description && <span className="suggest__what">{description}</span>}
        <span className="suggest__meta">
          {[
            placeCategoryLabel(category),
            fame > 0 ? t('suggest.fame', { n: fame }) : null,
            extra,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </span>
    </span>
  )
}
