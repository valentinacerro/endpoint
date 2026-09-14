import { describe, expect, it } from 'vitest'

import type { Suggestion } from '../api/types'
import { applyScores, buildPrompt, parseScores } from './taste'

const place = (name: string, category = 'sight'): Suggestion =>
  ({ name, lat: 0, lon: 0, category, fame: 0, wikidata: null, osm_id: name }) as Suggestion

const LIST = [place('Skytree'), place('Ichiran', 'food'), place('Sensō-ji', 'temple')]

describe('what the model is asked', () => {
  it('numbers the places, so the answer can only refer to these', () => {
    const prompt = buildPrompt(LIST, 'somewhere quiet')
    expect(prompt).toContain('0. Skytree')
    expect(prompt).toContain('2. Sensō-ji')
    expect(prompt).toContain('somewhere quiet')
  })
})

describe('reading whatever came back', () => {
  it('reads a clean answer', () => {
    expect([...parseScores('[{"i":0,"s":4},{"i":2,"s":1}]')]).toEqual([
      [0, 4],
      [2, 1],
    ])
  })

  it('digs the array out of the prose a small model wraps it in', () => {
    const reply = 'Sure! Here are my ratings:\n```json\n[{"i":1,"s":5}]\n```\nHope that helps.'
    expect([...parseScores(reply)]).toEqual([[1, 5]])
  })

  it('treats an answer that is not JSON as no answer', () => {
    // Which must mean "leave the order alone", never "score everything 0".
    expect(parseScores('I think you should visit Senso-ji!').size).toBe(0)
    expect(parseScores('[{"i":0,"s":4},]').size).toBe(0)
    expect(parseScores('').size).toBe(0)
  })

  it('drops entries that are not a number and an index', () => {
    const reply = '[{"i":0,"s":"high"},{"i":"x","s":3},{"i":1,"s":2},null,{"i":-1,"s":5}]'
    expect([...parseScores(reply)]).toEqual([[1, 2]])
  })

  it('clamps a score outside the range it asked for rather than dropping it', () => {
    // A model told to answer 0–5 will sometimes say 9; it means "a lot".
    expect([...parseScores('[{"i":0,"s":9},{"i":1,"s":-3}]')]).toEqual([
      [0, 5],
      [1, 0],
    ])
  })
})

describe('applying the scores', () => {
  it('is a permutation: same places, same number, never anything new', () => {
    const out = applyScores(LIST, new Map([[1, 5]]))
    expect(out).toHaveLength(LIST.length)
    expect(out.map((s) => s.suggestion.name).sort()).toEqual(
      LIST.map((s) => s.name).sort(),
    )
  })

  it('ignores an index the model invented', () => {
    // The whole defence: it cannot introduce a place that is not there.
    const out = applyScores(LIST, new Map([[99, 5]]))
    expect(out.map((s) => s.suggestion.name)).toEqual(['Skytree', 'Ichiran', 'Sensō-ji'])
  })

  it('puts the best match first', () => {
    const out = applyScores(LIST, new Map([[0, 1], [1, 5], [2, 3]]))
    expect(out.map((s) => s.suggestion.name)).toEqual(['Ichiran', 'Sensō-ji', 'Skytree'])
  })

  it('keeps what it did not score behind what it did, in the order it arrived', () => {
    // A partial answer has to be a partial improvement, not a shuffle.
    const out = applyScores(LIST, new Map([[2, 4]]))
    expect(out.map((s) => s.suggestion.name)).toEqual(['Sensō-ji', 'Skytree', 'Ichiran'])
  })

  it('breaks a tie by the order it was given, which is fame', () => {
    const out = applyScores(LIST, new Map([[0, 3], [1, 3], [2, 3]]))
    expect(out.map((s) => s.suggestion.name)).toEqual(['Skytree', 'Ichiran', 'Sensō-ji'])
  })

  it('leaves the order exactly alone when nothing was understood', () => {
    const out = applyScores(LIST, new Map())
    expect(out.map((s) => s.suggestion.name)).toEqual(LIST.map((s) => s.name))
    expect(out.every((s) => s.score === null)).toBe(true)
  })
})
