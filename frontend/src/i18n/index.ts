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

export function t(key: TranslationKey): string {
  return dictionaries[activeLocale][key]
}

export type { TranslationKey }
