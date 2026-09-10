/**
 * The list of IANA zones offered for autocomplete.
 *
 * `Intl.supportedValuesOf` gives the browser's full list, which is exactly
 * the set the backend validates against. Where it is missing, a short list
 * covering the trips this app is actually for beats offering nothing —
 * the field stays free text either way and the server has the final say.
 */

const FALLBACK = [
  'Europe/Rome',
  'Europe/London',
  'Europe/Paris',
  'Europe/Madrid',
  'Europe/Lisbon',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Shanghai',
  'Asia/Bangkok',
  'Asia/Dubai',
  'America/New_York',
  'America/Los_Angeles',
  'UTC',
]

export function timeZoneOptions(): string[] {
  const supported = (
    Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }
  ).supportedValuesOf
  try {
    return supported ? supported('timeZone') : FALLBACK
  } catch {
    return FALLBACK
  }
}
