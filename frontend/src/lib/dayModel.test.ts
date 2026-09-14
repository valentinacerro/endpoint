import { describe, expect, it } from 'vitest'

import type { Place } from '../api/types'

import { describeDay, promptFor, scoresById } from './dayModel'

/**
 * What the model is allowed to do, and what it cannot do whatever it says.
 *
 * The theme already knows a shop is a shop. What it cannot know is that
 * Ginza and Omotesandō are a day and Ginza and a suburban mall are an
 * errand — that is read rather than derived, and it is the one thing a
 * language model has over a lookup table here.
 *
 * The fence is the same one the taste sorter has: it scores places it was
 * handed, by index, and every index it invents is dropped. So it cannot
 * add somewhere that does not exist, lose one, rename one, or move a
 * coordinate.
 */

const place = (id: string, name: string, category: Place['category']): Place =>
  ({ id, name, category }) as Place

const GINZA = place('a', 'Ginza Six', 'shopping')
const OMOTESANDO = place('b', 'Omotesandō Hills', 'shopping')
const SENSOJI = place('c', 'Sensō-ji', 'temple')

describe('what the model is asked', () => {
  it('describes a day rather than naming our own label for it', () => {
    // "shopping" is a word in our schema. The model reads English about
    // travelling far better than it reads our vocabulary.
    const said = describeDay('shopping', 'Tokyo')
    expect(said).toContain('Tokyo')
    expect(said.toLowerCase()).toContain('shops')
  })

  it('asks about belonging together, not about being good', () => {
    // A famous place that fits nothing else is worth less to a day than
    // an ordinary one on the same street as the rest.
    expect(describeDay('shopping', 'Tokyo')).toContain('belongs in that day together with')
  })

  it('names every place with its number, because the answer is numbers', () => {
    const prompt = promptFor([GINZA, OMOTESANDO, SENSOJI], 'shopping', 'Tokyo')
    expect(prompt).toContain('0. Ginza Six')
    expect(prompt).toContain('2. Sensō-ji')
  })

  it('works for a city it has not been told the name of', () => {
    expect(describeDay('museums', null)).not.toContain('null')
  })
})

describe('what comes back', () => {
  const places = [GINZA, OMOTESANDO, SENSOJI]

  it('turns positions into scores against the places it was given', () => {
    const scores = scoresById(places, '[{"i":0,"s":5},{"i":2,"s":1}]')
    expect(scores.get('a')).toBe(5)
    expect(scores.get('c')).toBe(1)
    // Unmentioned is not zero: "said nothing" and "said it is bad" are
    // different, and only one of them should move a place.
    expect(scores.has('b')).toBe(false)
  })

  it('drops a place the model invented', () => {
    // Three were offered; there is no fourth, whatever it says.
    const scores = scoresById(places, '[{"i":0,"s":5},{"i":9,"s":5}]')
    expect([...scores.keys()]).toEqual(['a'])
  })

  it('reads an answer wrapped in the prose a small model adds', () => {
    const scores = scoresById(places, 'Sure! Here you go:\n```json\n[{"i":1,"s":4}]\n```\nHope that helps')
    expect(scores.get('b')).toBe(4)
  })

  it('treats nothing, prose and broken JSON alike as no opinion', () => {
    for (const reply of ['', 'I cannot help with that', '[{"i":0,"s":', '{"i":0}']) {
      expect(scoresById(places, reply).size, reply).toBe(0)
    }
  })

  it('clamps a score that left the range rather than discarding it', () => {
    // A model asked for 0–5 will sometimes answer 9, and meaning "very
    // much" is not a reason to throw the answer away.
    expect(scoresById(places, '[{"i":0,"s":9}]').get('a')).toBe(5)
  })
})
