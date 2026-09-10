/**
 * Comparing text the way a person would.
 *
 * Nobody typing into a search box reproduces the accents, the capitals or
 * the punctuation of what they are looking for — least of all on a phone
 * keyboard, in a hurry, in a language that is not the one the entry was
 * written in.
 */

/**
 * Case, accents and stray spacing removed.
 *
 * NFD splits an accented letter into the letter and its mark, and the mark
 * is then dropped: "Kyōto" and "Kyoto" become the same string, as do
 * "Café" and "cafe".
 */
export function fold(text: string): string {
  return text
    .trim()
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
}

/**
 * Letters and digits only.
 *
 * For the things people transcribe rather than read: a confirmation code
 * printed "ABC-123 / 45" is remembered as "abc12345", and a search that
 * insisted on the punctuation would find nothing.
 */
export function alnum(text: string): string {
  return fold(text).replace(/[^\p{Letter}\p{Number}]/gu, '')
}

/** The words of a query, folded, with the empties dropped. */
export function words(query: string): string[] {
  return fold(query).split(' ').filter(Boolean)
}
