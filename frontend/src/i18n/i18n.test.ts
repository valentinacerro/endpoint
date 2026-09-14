import { describe, expect, it } from 'vitest'

import { count, setLocale, t, LOCALES, type PluralKey } from './index'
import { en } from './locales/en'
import { it as italian } from './locales/it'

const dictionaries = { it: italian, en }

/**
 * Strings kept although nothing asks for them, each with its reason.
 * Not a dumping ground: a new entry here should feel like a decision.
 */
const ALLOWED_UNUSED: string[] = []

/** Every source file that could name a translation key. */
function readSources(): string[] {
  const modules = import.meta.glob('../**/*.{ts,tsx}', { as: 'raw', eager: true })
  return Object.entries(modules)
    .filter(([path]) => !path.includes('/locales/'))
    .map(([, text]) => text as string)
}

/** The base names of the keys that come in singular and plural. */
function pluralBases(): string[] {
  return Object.keys(italian)
    .filter((key) => key.endsWith('_other'))
    .map((key) => key.slice(0, -'_other'.length))
}

// The suite setup pins Italian before every test, so a test that wants
// another language just sets it and does not have to put it back.

describe('the dictionaries', () => {
  it('all carry exactly the same keys', () => {
    // The compiler enforces this too, but only for a dictionary declared
    // as `Record<TranslationKey, string>`. This catches the day someone
    // loosens that type.
    const italianKeys = Object.keys(italian).sort()
    for (const locale of LOCALES) {
      expect(Object.keys(dictionaries[locale]).sort(), locale).toEqual(italianKeys)
    }
  })

  it('never leaves a string empty', () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(dictionaries[locale])) {
        expect(value.trim(), `${locale}:${key}`).not.toBe('')
      }
    }
  })

  it('uses the same placeholders in every language', () => {
    // A translation that drops {count} silently loses the number; one
    // that invents {total} renders the braces to the reader.
    const placeholders = (text: string) => new Set(text.match(/\{\w+\}/g) ?? [])

    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(dictionaries[locale])) {
        const expected = placeholders(italian[key as keyof typeof italian])
        // A plural form may legitimately drop {count} — "One change to
        // send" reads better than "1 change to send" — so the check is
        // that nothing is invented, not that nothing is dropped.
        for (const name of placeholders(value)) {
          expect(expected, `${locale}:${key} has an extra ${name}`).toContain(name)
        }
      }
    }
  })

  it('gives every plural key the fallback every language relies on', () => {
    for (const locale of LOCALES) {
      for (const base of pluralBases()) {
        expect(dictionaries[locale], `${locale}:${base}_other`).toHaveProperty(`${base}_other`)
      }
    }
  })

  it('says something for every plural key at every count', () => {
    // Categories are not the same everywhere and not all are spelled
    // out: Italian has a `many` in current CLDR, for 11 and 80 and 800,
    // which none of these strings care about and none of them define.
    // What matters is that every count reaches a real form rather than
    // an `undefined`.
    //
    // It deliberately does NOT check for leftover {braces}. The caller
    // supplies those, and a test cannot know what any given caller
    // passes: guessing a fixed list makes a correct new key fail, and
    // reading the list off the string being checked makes the assertion
    // circular. The property that IS checkable is the next test.
    for (const locale of LOCALES) {
      setLocale(locale)
      for (const base of pluralBases()) {
        for (const n of [0, 1, 2, 5, 11, 21, 80, 100]) {
          const rendered = count(base as PluralKey, n)
          expect(rendered, `${locale}:${base}@${n}`).toBeTruthy()
          expect(rendered, `${locale}:${base}@${n}`).not.toContain('undefined')
        }
      }
    }
  })

  it('asks each form of a plural for the same things', () => {
    // The real risk. If `_other` mentions {days} and `_one` does not,
    // every caller that passes {days} is correct and the singular still
    // renders a hole — or worse, a caller written against the singular
    // leaves braces on screen the first time a count reaches two.
    //
    // {count} is the exception: "One change to send" reads better than
    // "1 change to send", so a singular may drop it.
    const placeholders = (text: string) =>
      new Set([...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))

    for (const locale of LOCALES) {
      for (const base of pluralBases()) {
        const forms = Object.entries(dictionaries[locale]).filter(([key]) =>
          key.startsWith(`${base}_`),
        )
        const sets = forms.map(([key, text]) => {
          const names = placeholders(text)
          names.delete('count')
          return [key, names] as const
        })
        for (const [key, names] of sets) {
          for (const [otherKey, otherNames] of sets) {
            for (const name of names) {
              expect([...otherNames], `${key} has {${name}} but ${otherKey} does not`).toContain(
                name,
              )
            }
          }
        }
      }
    }
  })

  it('has no string nobody asks for', () => {
    // The same check the stylesheet has had for months, and the reason
    // it exists there: a string left behind by a rewrite is invisible.
    // Ten of these were found the first time this ran, including the
    // three specific messages for a bad Google Maps link — the server
    // still sent the codes and nothing read them any more, so every bad
    // link said only "could not read that".
    //
    // Keys reached by a template literal are matched by their prefix,
    // because `t(\`trip_plan.day.${refusal}\`)` never names them in full.
    const source = [
      ...new globalThis.Array<string>(),
      ...readSources(),
    ].join('\n')

    const orphans = Object.keys(italian).filter((key) => {
      const base = key.replace(/_(one|other|many|few|two|zero)$/, '')
      if (source.includes(`'${base}'`)) return false
      const prefix = base.slice(0, base.lastIndexOf('.') + 1)
      return !(prefix && source.includes(`\`${prefix}`))
    })

    expect(orphans, `unused: ${orphans.join(', ')}`).toEqual(ALLOWED_UNUSED)
  })

  it('has no plural key without both halves', () => {
    const ones = Object.keys(italian).filter((key) => key.endsWith('_one'))
    for (const one of ones) {
      expect(italian).toHaveProperty(`${one.slice(0, -'_one'.length)}_other`)
    }
  })
})

describe('t', () => {
  it('substitutes placeholders', () => {
    expect(t('timeline.day', { n: 3 })).toBe('Giorno 3')
  })

  it('leaves an unknown placeholder alone rather than blanking it', () => {
    // Better a visible {n} than a sentence with a hole in it.
    expect(t('timeline.day')).toBe('Giorno {n}')
  })

  it('follows the chosen language', () => {
    expect(t('tabs.trip')).toBe('Viaggio')
    setLocale('en')
    expect(t('tabs.trip')).toBe('Trip')
  })
})

describe('count', () => {
  it('agrees with one', () => {
    // The reason this exists. Before it, the app said "1 modifiche".
    expect(count('sync.pending', 1)).toBe('Una modifica da inviare')
  })

  it('agrees with more than one', () => {
    expect(count('sync.pending', 5)).toBe('5 modifiche da inviare')
  })

  it('treats zero as plural in Italian', () => {
    expect(count('sync.pending', 0)).toBe('0 modifiche da inviare')
  })

  it('passes the count through without being asked', () => {
    expect(count('memories.thatDay', 7)).toBe('7 scatti')
  })

  it('takes other placeholders alongside the count', () => {
    setLocale('en')
    expect(count('diary.progress', 1, { writable: 5 })).toBe('Written 1 day of 5')
    expect(count('diary.progress', 3, { writable: 5 })).toBe('Written 3 days of 5')
  })

  it('follows the chosen language too', () => {
    expect(count('memories.thatDay', 1)).toBe('Uno scatto')
    setLocale('en')
    expect(count('memories.thatDay', 1)).toBe('One shot')
  })

  it('asks only for the values its callers actually pass', () => {
    // The check that was missing, and the bug it would have caught: the
    // home screen showed "{n} giorni" to the reader for days, because
    // `count()` fills `{count}` and the string asked for `{n}`. Every
    // other guard here compares the dictionaries with each other, so a
    // mistake made in both languages at once — which is what happens when
    // one person writes both — went straight through.
    //
    // Reads the call sites instead: `count('key', n)` supplies `count`,
    // plus whatever a third argument names.
    const source = readSources().join('\n')
    const wrong: string[] = []

    for (const opening of [...source.matchAll(/\bcount\(\s*'([\w.]+)'/g)]) {
      const key = opening[1]
      // Walk to the matching close paren rather than the first one: the
      // arguments routinely contain calls of their own, and `[^)]*` stops
      // inside `.join(', ')` — which made this report six false alarms
      // the first time it ran.
      let depth = 0
      let end = opening.index
      for (let at = opening.index; at < source.length; at += 1) {
        if (source[at] === '(') depth += 1
        else if (source[at] === ')') {
          depth -= 1
          if (depth === 0) {
            end = at
            break
          }
        }
      }
      const call = source.slice(opening.index, end)
      const supplied = new Set(['count'])
      const object = call.match(/\{([\s\S]*)\}/)
      if (object) {
        // `{ total: n }` and the shorthand `{ found }` both count.
        for (const [, name] of object[1].matchAll(/(?:^|[,{\s])([A-Za-z_]\w*)\s*:/g)) {
          supplied.add(name)
        }
        for (const [, name] of object[1].matchAll(/(?:^|[,{\s])([A-Za-z_]\w*)\s*(?=[,}])/g)) {
          supplied.add(name)
        }
      }

      for (const form of ['_one', '_other'] as const) {
        const template = italian[(key + form) as keyof typeof italian]
        if (!template) continue
        for (const [, asked] of String(template).matchAll(/\{(\w+)\}/g)) {
          if (!supplied.has(asked)) {
            wrong.push(`${key}${form} asks for {${asked}}, caller gives ${[...supplied].join(', ')}`)
          }
        }
      }
    }

    expect([...new Set(wrong)]).toEqual([])
  })
})
