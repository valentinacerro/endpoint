import { useEffect, useState } from 'react'

import type { Suggestion } from '../api/types'
import { t } from '../i18n'
import { applyScores, buildPrompt, MAX_CANDIDATES, parseScores } from '../lib/taste'
import { ask, canRun, type Progress } from '../lib/webllm'
import { Icon } from './Icon'

/**
 * Reorder the suggestions from a sentence, using a model on the phone.
 *
 * The ticked categories know you came to eat. They do not know you want
 * somewhere quiet with no queue, and that is the only thing this adds.
 *
 * Offered only where it can actually run, and never as the way the list
 * works: the order underneath is fame, the categories move it, and this
 * moves it again. Every one of those is reversible by doing nothing.
 */
export function TasteSort({
  candidates,
  onReorder,
}: {
  candidates: readonly Suggestion[]
  onReorder: (order: Suggestion[]) => void
}) {
  const [possible, setPossible] = useState<boolean | null>(null)
  const [description, setDescription] = useState('')
  const [progress, setProgress] = useState<Progress | null>(null)
  const [failed, setFailed] = useState(false)
  const [applied, setApplied] = useState(0)

  useEffect(() => {
    let live = true
    void canRun().then((yes) => live && setPossible(yes))
    return () => {
      live = false
    }
  }, [])

  // Unanswered, or answered no: nothing is offered. A feature that
  // appears and then fails on the device it was offered to is worse than
  // one that was never there.
  if (possible !== true) return null

  async function run() {
    setFailed(false)
    setApplied(0)
    const shortlist = candidates.slice(0, MAX_CANDIDATES)
    try {
      const reply = await ask(buildPrompt(shortlist, description), setProgress)
      const scores = parseScores(reply)
      const ordered = applyScores(shortlist, scores)
      // The tail beyond what the model saw keeps its place at the end.
      onReorder([...ordered.map((item) => item.suggestion), ...candidates.slice(MAX_CANDIDATES)])
      setApplied(scores.size)
    } catch {
      setFailed(true)
    } finally {
      setProgress(null)
    }
  }

  if (progress) {
    return (
      <p className="hint">
        {progress.fraction === null
          ? t('taste.thinking')
          : t('taste.loading', { percent: Math.round(progress.fraction * 100) })}
      </p>
    )
  }

  return (
    <div className="stack stack--tight">
      <label className="field">
        <span className="field__label">{t('taste.label')}</span>
        <input
          className="field__input"
          value={description}
          placeholder={t('taste.placeholder')}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <p className="muted small">{t('taste.hint')}</p>

      {failed && <p className="field__error">{t('taste.failed')}</p>}
      {applied > 0 && <p className="hint">{t('taste.applied', { n: applied })}</p>}

      <div className="row row--end">
        <button
          className="button button--quiet button--small"
          onClick={() => void run()}
          disabled={description.trim().length < 3}
        >
          <Icon name="star" size={14} />
          {t('taste.sort')}
        </button>
      </div>
    </div>
  )
}
