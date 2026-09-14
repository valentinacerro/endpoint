/**
 * Cross-check the class names used in components against the stylesheet.
 *
 * A misspelled class fails silently: no error, no warning, just a component
 * with no styling that you notice three screens later. This catches that,
 * and the reverse — rules left behind after a refactor.
 *
 * Run with: npm run check:classes
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = new URL('../src/', import.meta.url).pathname
const CSS = join(SRC, 'index.css')

/**
 * Classes the scanner cannot see, with the reason.
 *
 * Not a dumping ground: each entry says why it is unreachable by static
 * inspection, and anything that stops being true should come off the list.
 */
const NOT_IN_JSX = new Map([
  ['map-pin', 'written into Leaflet marker HTML, not a className'],
  ['map-pin-wrap', 'passed to Leaflet as its icon className'],
])

/**
 * Prefixes owned by a library that writes its own markup. We still style
 * them — a guided-tour popover in someone else's greys looks like another
 * app — but they will never appear in a `className` here.
 */
const LIBRARY_PREFIXES = ['driver-']

const CLASS_NAME = /^[a-z][a-z0-9_-]*$/

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return walk(full)
    return full.endsWith('.tsx') ? [full] : []
  })
}

/**
 * Read the string literal starting at `start`, returning its text.
 *
 * Inside a template, `${...}` is code rather than text: it is skipped and
 * replaced with a space, so `a${x}b` cannot be misread as the word "ab".
 */
function readString(source, start) {
  const quote = source[start]
  let index = start + 1
  let text = ''

  while (index < source.length) {
    const char = source[index]
    if (char === '\\') {
      index += 2
      continue
    }
    if (quote === '`' && char === '$' && source[index + 1] === '{') {
      let depth = 1
      index += 2
      while (index < source.length && depth > 0) {
        if (source[index] === '{') depth += 1
        else if (source[index] === '}') depth -= 1
        index += 1
      }
      text += ' '
      continue
    }
    if (char === quote) return { text, end: index }
    text += char
    index += 1
  }
  return { text, end: index }
}

/**
 * What the components ask for.
 *
 * Only text inside string literals counts, and interpolations are read
 * recursively so a class written as `${flag ? 'a--on' : ''}` is seen.
 * Bare identifiers are ignored: collecting them would report every
 * variable in the file as a missing class.
 */
function collect(value, literal) {
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (char !== '"' && char !== "'" && char !== '`') continue

    const { text, end } = readString(value, index)
    for (const name of text.split(/\s+/)) {
      // A stub left by a skipped interpolation is a family prefix, not a
      // class anyone wrote.
      if (CLASS_NAME.test(name) && !name.endsWith('--')) literal.add(name)
    }

    // A template's interpolations may themselves hold class strings.
    if (char === '`') collect(value.slice(index + 1, end), literal)
    index = end
  }
}

function scan() {
  const literal = new Set()
  const families = new Set()

  for (const file of walk(SRC)) {
    const source = readFileSync(file, 'utf8')
    let at = 0

    while ((at = source.indexOf('className=', at)) !== -1) {
      at += 'className='.length
      let to = at

      if (source[at] === '"' || source[at] === "'") {
        to = readString(source, at).end + 1
      } else if (source[at] === '{') {
        // Counted brace by brace: `{({ isActive }) => …}` nests, and a
        // regex stopping at the first `}` would silently truncate it.
        let depth = 0
        for (to = at; to < source.length; to += 1) {
          if (source[to] === '{') depth += 1
          else if (source[to] === '}' && --depth === 0) break
        }
        to += 1
      } else {
        continue
      }

      const value = source.slice(at, to)
      for (const dynamic of value.matchAll(/([a-z][a-z0-9_-]*--)\$\{/g)) {
        families.add(dynamic[1])
      }
      collect(value, literal)
      at = to
    }
  }
  return { literal, families }
}

/**
 * Selectors defined more than once at the top level.
 *
 * The check this file did not have, and the bug it therefore missed: the
 * diary was given a `.entry` block that the timeline already owned. Same
 * specificity, so the later rule won, and the timeline's grid silently
 * became a flex column — no error, no warning, a main screen laid out
 * wrongly for four commits.
 *
 * Only top-level rules count. Patching a class inside `@media` is how
 * dark mode and print are meant to work, and a grouped selector list
 * (`.a,\n.b,\n.c {`) is one rule, not three definitions of its last
 * member.
 */
function duplicateDefinitions() {
  const lines = readFileSync(CSS, 'utf8').split('\n')
  const seen = new Map()
  let depth = 0
  let atRuleDepth = 0
  let continuesAGroup = false

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim()

    if (trimmed.startsWith('@') && trimmed.includes('{') && atRuleDepth === 0) {
      atRuleDepth = depth + 1
    }

    if (depth === 0 && atRuleDepth === 0 && !continuesAGroup) {
      const alone = /^(\.[a-z][a-z0-9_-]*)\s*\{/.exec(line)
      if (alone) {
        const name = alone[1].slice(1)
        seen.set(name, [...(seen.get(name) ?? []), index + 1])
      }
    }

    // A selector line ending in a comma opens a group; the lines that
    // follow are part of the same rule, not new definitions.
    if (depth === 0 && atRuleDepth === 0) continuesAGroup = trimmed.endsWith(',')

    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length
    if (atRuleDepth && depth < atRuleDepth) atRuleDepth = 0
  }

  return [...seen].filter(([name, at]) => at.length > 1 && !SPLIT_ON_PURPOSE.has(name))
}

/**
 * Selectors deliberately written twice, with the reason. Not a dumping
 * ground: a second entry here should feel like a decision.
 */
const SPLIT_ON_PURPOSE = new Map([
  ['entry__time', 'grid-area declared beside the grid it belongs to, styled with its siblings'],
  ['entry__marker', 'as above'],
  ['entry__content', 'as above'],
])

function definedClasses() {
  const css = readFileSync(CSS, 'utf8')
  // Leading whitespace allowed: rules inside `@media` are indented, and
  // anchoring at column zero made this checker blind to every one of
  // them — so a class defined only for print or only for dark mode was
  // reported as missing from the stylesheet it was sitting in.
  return new Set([...css.matchAll(/^[ \t]*\.([a-z][a-z0-9_-]*)/gm)].map((match) => match[1]))
}

const { literal, families } = scan()
const defined = definedClasses()
const inFamily = (name) => [...families].some((prefix) => name.startsWith(prefix))

const duplicated = duplicateDefinitions()
const missing = [...literal].filter((name) => !defined.has(name)).sort()
const orphaned = [...defined]
  .filter(
    (name) =>
      !literal.has(name) &&
      !inFamily(name) &&
      !NOT_IN_JSX.has(name) &&
      !LIBRARY_PREFIXES.some((prefix) => name.startsWith(prefix)),
  )
  .sort()

let failed = false
if (duplicated.length) {
  failed = true
  console.error('Defined more than once, so the later rule silently wins:')
  for (const [name, at] of duplicated) console.error(`  .${name} — lines ${at.join(', ')}`)
}
if (missing.length) {
  failed = true
  console.error('Used in a component but absent from the stylesheet:')
  for (const name of missing) console.error(`  .${name}`)
}
if (orphaned.length) {
  failed = true
  console.error('Defined in the stylesheet but used nowhere:')
  for (const name of orphaned) console.error(`  .${name}`)
}

if (failed) process.exit(1)
console.log(
  `Classes agree: ${literal.size} used, ${defined.size} defined, ` +
    `${families.size} built dynamically, none defined twice.`,
)
