import { useEffect, useState } from 'react'

import { usePlaceSearch } from '../api/trips'
import type { PlaceHit } from '../api/types'
import { t } from '../i18n'
import { placeCategoryLabel } from '../i18n/labels'

/**
 * Long enough that a pause reads as "I have finished typing", short
 * enough that the list feels like it is keeping up.
 */
const SETTLE_MS = 300

interface Props {
  label: string
  /** Where you are, so "ramen" means the ramen near you. */
  near: { lat: number; lon: number } | null
  onPick: (hit: PlaceHit) => void
  /**
   * Every keystroke, not only the chosen ones.
   *
   * Without it, typing a name nobody has ever put on a map — the bar a
   * friend recommended — would leave the form thinking the field was
   * empty. Suggestions are an offer, never the only way through.
   */
  onText: (text: string) => void
  /** What is in the box to begin with, when editing something. */
  initial?: string
  autoFocus?: boolean
}

/**
 * Type a name, pick the place.
 *
 * The alternative this replaces is a form with a name field and two
 * coordinate fields, which nobody fills in — which is why so many saved
 * places end up as a name and nothing else, invisible to the map and to
 * the day planner.
 *
 * What it fills in is a suggestion, not a decision: the name lands in
 * the field and stays editable, because the official name of a place is
 * often not what you call it.
 */
export function PlaceSearch({ label, near, onPick, onText, initial = '', autoFocus }: Props) {
  const [text, setText] = useState(initial)
  const [settled, setSettled] = useState(initial)
  const [open, setOpen] = useState(false)

  // Debounced: one request per pause, not one per keystroke. Photon is
  // somebody else's free service and this is the difference between
  // using it and abusing it.
  useEffect(() => {
    const timer = setTimeout(() => setSettled(text), SETTLE_MS)
    return () => clearTimeout(timer)
  }, [text])

  const hits = usePlaceSearch(settled, near)
  const suggestions = open ? (hits.data ?? []) : []

  function choose(hit: PlaceHit) {
    setText(hit.name)
    setOpen(false)
    onText(hit.name)
    onPick(hit)
  }

  return (
    <div className="lookup">
      <label className="field">
        <span className="field__label">{label}</span>
        <input
          className="field__input"
          value={text}
          onChange={(event) => {
            setText(event.target.value)
            onText(event.target.value)
            setOpen(true)
          }}
          // A place name is not a word the keyboard knows, and being
          // corrected to one mid-search is maddening.
          autoCorrect="off"
          autoCapitalize="words"
          spellCheck={false}
          autoFocus={autoFocus}
          // Late enough that a tap on a suggestion lands first.
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onFocus={() => setOpen(true)}
        />
      </label>

      {open && hits.isFetching && suggestions.length === 0 && (
        <p className="muted small">{t('lookup.searching')}</p>
      )}

      {suggestions.length > 0 && (
        <ul className="lookup__list">
          {suggestions.map((hit) => (
            <li key={`${hit.lat},${hit.lon},${hit.name}`}>
              <button type="button" className="lookup__hit" onClick={() => choose(hit)}>
                <span className="lookup__name">{hit.name}</span>
                <span className="lookup__where">
                  {[placeCategoryLabel(hit.category), hit.where].filter(Boolean).join(' · ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Two different facts, and for a long time both read as the first
          one. A dependency started refusing anonymous clients and the box
          said "no place by that name" for Tokyo — with nothing anywhere
          saying the lookup was down. */}
      {open && settled.trim().length >= 3 && !hits.isFetching && hits.isError && (
        <p className="hint">{t('lookup.unavailable')}</p>
      )}

      {open &&
        settled.trim().length >= 3 &&
        !hits.isFetching &&
        !hits.isError &&
        suggestions.length === 0 && <p className="muted small">{t('lookup.nothing')}</p>}
    </div>
  )
}
