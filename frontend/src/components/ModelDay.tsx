import { useEffect, useState } from 'react'

import type { DayTheme, Place } from '../api/types'
import { t } from '../i18n'
import { dayThemeLabel } from '../i18n/labels'
import { MAX_CANDIDATES, promptFor, scoresById } from '../lib/dayModel'
import { ask, canRun, type Progress } from '../lib/webllm'

/**
 * Let the model have a say about a themed day.
 *
 * The theme already knows a shop is a shop. What it cannot know is that
 * Ginza and Omotesandō are a day and Ginza and a suburban mall are an
 * errand — read rather than derived, and the one thing a language model
 * has over a lookup table here.
 *
 * Offered, never automatic, and hidden entirely where WebGPU is missing
 * rather than offered and then failing. The weights are a few hundred
 * megabytes on first use; after that they sit in the browser's cache and
 * it works with no signal, like the rest of the app. Nothing about where
 * you are going leaves the phone.
 */
export function ModelDay({
  places,
  theme,
  city,
  onScores,
}: {
  places: readonly Place[]
  theme: DayTheme
  city: string | null
  onScores: (scores: ReadonlyMap<string, number>) => void
}) {
  const [possible, setPossible] = useState<boolean | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [failed, setFailed] = useState(false)
  const [said, setSaid] = useState<number | null>(null)

  useEffect(() => {
    let live = true
    void canRun().then((yes) => live && setPossible(yes))
    return () => {
      live = false
    }
  }, [])

  // Not "unavailable", not a disabled button with an explanation: a thing
  // this device cannot do is a thing this device does not offer.
  if (possible !== true || places.length === 0) return null

  // Enough to choose from, few enough to fit a small model's context.
  const shortlist = places.slice(0, MAX_CANDIDATES)

  async function run() {
    setFailed(false)
    setSaid(null)
    try {
      const reply = await ask(promptFor(shortlist, theme, city), setProgress)
      const scores = scoresById(shortlist, reply)
      setSaid(scores.size)
      onScores(scores)
    } catch {
      // A model that will not load, will not answer, or answers with
      // nothing all mean the same thing: the plan stays as it was.
      setFailed(true)
    } finally {
      setProgress(null)
    }
  }

  return (
    <div className="stack stack--tight">
      {/* The theme alone. Several of these sit together under one
          heading, and "Chiedi al modello: giornata «All'aperto»" is forty
          characters — wider than a 320px screen has to give a button, and
          the same forty characters three times over. */}
      <button className="button button--quiet" onClick={() => void run()} disabled={progress !== null}>
        {progress === null ? dayThemeLabel(theme) : t('model.working')}
      </button>

      {progress !== null && (
        <p className="muted small">
          {progress.fraction === null
            ? t('model.thinking')
            : t('model.downloading', { percent: Math.round(progress.fraction * 100) })}
        </p>
      )}

      {said !== null && (
        <p className="hint">
          {said === 0
            ? t('model.saidNothing')
            : t('model.ratedFor', { count: said, theme: dayThemeLabel(theme) })}
        </p>
      )}

      {failed && <p className="muted small">{t('model.failed')}</p>}
    </div>
  )
}
