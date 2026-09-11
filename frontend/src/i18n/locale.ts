/**
 * Which language the app is in, and how to change it.
 *
 * Separate from the dictionaries so that `lib/datetime.ts` can format
 * dates in the chosen language without importing four translation files
 * to do it.
 *
 * No i18n library. The one thing a library would genuinely buy is
 * pluralisation, and `Intl.PluralRules` — a browser API this app already
 * leans on heavily for dates and money — does that in a dozen lines. The
 * rest would be paying thirty kilobytes to get back the compile-time key
 * checking that falls out of a plain object for free.
 */

export const LOCALES = ['it', 'en'] as const

export type Locale = (typeof LOCALES)[number]

const STORAGE_KEY = 'endpoint.locale'

function isLocale(value: string | null): value is Locale {
  return value !== null && (LOCALES as readonly string[]).includes(value)
}

/**
 * The language to start in.
 *
 * A stored choice wins; otherwise the browser's, if we speak it; and
 * Italian if we do not. "en-GB" is matched on its first part, because a
 * language tag carries a region we have no opinion about.
 *
 * Adding a language is one file and one entry in `LOCALES`: the keys
 * come from the Italian dictionary and the compiler insists on a
 * complete translation, so nothing else has to be found and changed.
 */
function initial(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (isLocale(stored)) return stored
  } catch {
    // Private browsing, or storage disabled. Not a reason to fail.
  }

  for (const tag of typeof navigator === 'undefined' ? [] : navigator.languages) {
    const base = tag.split('-')[0]
    if (isLocale(base)) return base
  }
  return 'it'
}

let current: Locale = initial()
const listeners = new Set<() => void>()

export function activeLocale(): Locale {
  return current
}

export function setLocale(locale: Locale): void {
  if (locale === current) return
  current = locale
  try {
    localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    // The choice still applies for this session.
  }
  for (const listener of listeners) listener()
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** English names would be unhelpful in a language picker. */
export const LOCALE_NAMES: Record<Locale, string> = {
  it: 'Italiano',
  en: 'English',
}
