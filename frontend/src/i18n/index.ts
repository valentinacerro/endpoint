/**
 * Translations.
 *
 * Italian is the source dictionary: `TranslationKey` is derived from it,
 * and every other language is declared as a complete record of those
 * keys — so forgetting to translate something is a compilation error
 * rather than an English screen with an Italian sentence in the middle.
 */

import { useSyncExternalStore } from 'react'

import { activeLocale, subscribe, type Locale } from './locale'
import { en } from './locales/en'
import { it, type TranslationKey } from './locales/it'

const dictionaries: Record<Locale, Record<TranslationKey, string>> = { it, en }

type Params = Record<string, string | number>

function fill(template: string, params?: Params): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  )
}

/**
 * Look up a string, substituting `{placeholders}`.
 *
 * Interpolation rather than concatenation at the call site, because word
 * order differs between languages: "3 nights in Kyoto" and "3 notti a
 * Kyoto" do not put the pieces in the same places, and "Kyoto: 3 nuits"
 * puts them somewhere else again.
 */
export function t(key: TranslationKey, params?: Params): string {
  return fill(dictionaries[activeLocale()][key], params)
}

/**
 * Keys that come in a singular and a plural: `x.y_one`, `x.y_other`.
 *
 * The base names are recovered from the dictionary by type, so `count()`
 * accepts exactly the keys that have plural forms and nothing else.
 */
type BaseOf<K> = K extends `${infer Base}_other` ? Base : never
export type PluralKey = BaseOf<TranslationKey>

/**
 * A string that agrees with a number.
 *
 * The whole reason this file does not delegate to a library. Without it
 * the app says "1 spese" and "1 giorni", which is the sort of thing that
 * makes software feel machine-made. `Intl.PluralRules` knows the
 * categories each language actually uses — Italian and Spanish want one
 * and other, French counts zero as singular, and a language added later
 * may want more than two.
 *
 * The count is also passed through as `{count}`, since that is nearly
 * always the number being agreed with.
 */
export function count(key: PluralKey, value: number, params?: Params): string {
  const locale = activeLocale()
  const category = new Intl.PluralRules(locale).select(value)
  const dictionary = dictionaries[locale]

  // `other` is the form every language has, and the fallback for a
  // category a translation does not spell out separately. Italian, for
  // one, has a `many` category in current CLDR — 11, 8, 80, 800, where
  // the article before the number elides — which none of these strings
  // are affected by. Falling back beats twenty-three duplicated lines.
  const exact = `${key}_${category}` as TranslationKey
  const template = dictionary[exact] ?? dictionary[`${key}_other` as TranslationKey]

  return fill(template, { count: value, ...params })
}

/**
 * Re-render when the language changes.
 *
 * Called once at the root. Nothing in this app is memoised, so a render
 * there reaches every screen — which is why `t()` can stay an ordinary
 * function that any module may import, instead of a hook that would have
 * to be threaded through `lib/` and `i18n/labels.ts` as well.
 */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, activeLocale, activeLocale)
}

export { activeLocale, setLocale, LOCALES, LOCALE_NAMES, type Locale } from './locale'
export type { TranslationKey }
