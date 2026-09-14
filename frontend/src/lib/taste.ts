/**
 * Ordering the suggestions by a sentence you wrote.
 *
 * The categories you can tick are a blunt instrument: they know you came
 * to eat, not that you want somewhere quiet with no queue. That is what a
 * language model is actually good for here — reading a preference in
 * words and applying it to a list.
 *
 * The shape matters more than the model. It is never asked to produce
 * places, or to return a list, or to write anything a reader will see: it
 * scores candidates it was handed, by index, and every index it invents
 * is dropped. So it cannot add a place that does not exist, lose one,
 * rename one, or move a coordinate — the worst it can do is rank badly,
 * which you can see and undo. A model that runs in a phone browser is
 * small and will sometimes answer with prose, half a JSON object or
 * nothing at all, and all three have to mean "leave the order alone".
 */

import type { Suggestion } from '../api/types'
import { placeCategoryLabel } from '../i18n/labels'

/** Above this, the prompt stops fitting comfortably in a small model. */
export const MAX_CANDIDATES = 40

export interface Scored {
  suggestion: Suggestion
  /** 0–5, or null when the model said nothing about it. */
  score: number | null
}

export function buildPrompt(candidates: readonly Suggestion[], description: string): string {
  const list = candidates
    .map((item, index) => `${index}. ${item.name} (${placeCategoryLabel(item.category)})`)
    .join('\n')

  return [
    'You rank places to visit for one traveller.',
    '',
    'Traveller says:',
    description.trim(),
    '',
    'Places:',
    list,
    '',
    'Reply with ONLY a JSON array, one entry per place you rated,',
    'like [{"i":0,"s":4},{"i":1,"s":1}].',
    '"i" is the number of the place. "s" is 0 to 5, where 5 means it fits',
    'what the traveller said and 0 means it does not. No other text.',
  ].join('\n')
}

/**
 * Read whatever came back, and ignore everything that is not a score.
 *
 * A small model will wrap the array in prose, or in a code fence, or emit
 * one trailing comma too many. The first balanced array in the reply is
 * taken; if none parses, every score is null and the caller keeps its own
 * order.
 */
export function parseScores(reply: string): Map<number, number> {
  const scores = new Map<number, number>()
  const start = reply.indexOf('[')
  const end = reply.lastIndexOf(']')
  if (start === -1 || end <= start) return scores

  let parsed: unknown
  try {
    parsed = JSON.parse(reply.slice(start, end + 1))
  } catch {
    return scores
  }
  if (!Array.isArray(parsed)) return scores

  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue
    const { i, s } = entry as { i?: unknown; s?: unknown }
    if (typeof i !== 'number' || !Number.isInteger(i) || i < 0) continue
    if (typeof s !== 'number' || !Number.isFinite(s)) continue
    // Clamped rather than rejected: a model asked for 0–5 will sometimes
    // answer 7, and meaning "very much" is not a reason to discard it.
    scores.set(i, Math.max(0, Math.min(5, s)))
  }
  return scores
}

/**
 * The same places, in the order the scores suggest.
 *
 * Same length, same members, always — this only ever permutes. Anything
 * the model did not score keeps its place behind what it did, in the
 * order it arrived, so a partial answer degrades into a partial
 * improvement rather than a shuffle.
 */
export function applyScores(
  candidates: readonly Suggestion[],
  scores: ReadonlyMap<number, number>,
): Scored[] {
  const scored = candidates.map((suggestion, index) => ({
    suggestion,
    score: scores.has(index) ? (scores.get(index) as number) : null,
    index,
  }))

  return scored
    .slice()
    .sort((a, b) => {
      // Equal scores — both null included — keep the order they came in,
      // which is fame: among equally good matches the better known one is
      // still first. Handled here, so the comparison below never sees a
      // tie and needs no second key. (It had one until sabotage showed it
      // could not be reached.)
      if (a.score === b.score) return a.index - b.index
      if (a.score === null) return 1
      if (b.score === null) return -1
      return b.score - a.score
    })
    .map(({ suggestion, score }) => ({ suggestion, score }))
}
