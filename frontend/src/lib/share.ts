/**
 * Getting links out of whatever was handed to us.
 *
 * Two callers, one problem. Android's share sheet rarely hands over a
 * bare URL: Google Maps sends something like "Senso-ji\nhttps://maps.app.goo.gl/xyz",
 * and other apps wrap it in a sentence. And someone planning at a laptop
 * pastes a dozen links into a box at once. Both are text with links in
 * it, so both go through here.
 */

/** Trailing punctuation that belongs to the sentence, not to the link. */
const TRAILING = /[.,;:!?)\]}'"»]+$/

/**
 * Every link in a piece of text, in order, without repeats.
 *
 * Repeats matter: a share sometimes carries the same URL in both the
 * text and the url field, and importing the same place twice because of
 * that would be a silly way to get duplicates.
 */
export function linksIn(text: string | null | undefined): string[] {
  if (!text) return []

  const found = text.match(/https?:\/\/[^\s<>"]+/gi) ?? []
  const cleaned = found.map((link) => link.replace(TRAILING, '')).filter(Boolean)
  return [...new Set(cleaned)]
}

/**
 * Does this look like a whole saved list rather than one place?
 *
 * Only answerable for the long form. A `maps.app.goo.gl` short link
 * could be either and only says which once it has been followed, which
 * is the server's job.
 */
export function looksLikeAList(url: string): boolean {
  return /\/maps\/placelists\/|\/local\/userlists\//.test(url)
}

/**
 * A short name for a link, for showing which one is being worked on.
 *
 * A Maps place URL carries the name in the path — but not in the last
 * segment, which is usually the viewport coordinates. The segment after
 * `/place/` is the one worth showing; everything else falls back to the
 * host, because a row reading "@35.7,139.8" tells you nothing about
 * which of your twelve links is being fetched.
 */
export function shortenLink(url: string): string {
  try {
    const parsed = new URL(url)
    const path = decodeURIComponent(parsed.pathname)

    const named = /\/place\/([^/@]+)/.exec(path)
    if (named) return named[1].replace(/\+/g, ' ').trim()

    return parsed.host
  } catch {
    return url.slice(0, 40)
  }
}
