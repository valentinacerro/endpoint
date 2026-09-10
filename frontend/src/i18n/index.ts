/**
 * Translations.
 *
 * Today there is only Italian and `t()` is a table lookup. The structure is
 * already the final one though: in Phase 3 we add the en/es/fr files and a
 * language picker, without touching any call site.
 */

import { it, type TranslationKey } from './locales/it'

const dictionaries = { it } as const

export type Locale = keyof typeof dictionaries

export const activeLocale: Locale = 'it'

/**
 * Look up a string, substituting `{placeholders}`.
 *
 * Interpolation rather than string concatenation at the call site, because
 * word order differs between languages: "3 nights in Kyoto" and its Italian
 * equivalent do not put the pieces in the same places.
 */
export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  const template = dictionaries[activeLocale][key]
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  )
}

export type { TranslationKey }
