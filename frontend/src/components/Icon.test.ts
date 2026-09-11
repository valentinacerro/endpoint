import { describe, expect, it } from 'vitest'

import { ICON_PATHS, type IconName } from './Icon'

/**
 * The icons are hand-written path data, which is the kind of thing that
 * reads fine in a diff and renders wrong on a phone.
 *
 * Two failures are silent. A coordinate outside the 24×24 box is clipped
 * at the edge rather than reported. And in the compact arc form the two
 * flags run into the number after them — `a5 5 0 1110 0` is
 * large-arc 1, sweep 1, x 10 — so a missing flag shifts every parameter
 * after it and draws something else entirely, without an error.
 */

const names = Object.keys(ICON_PATHS) as IconName[]

/** One command letter and the numbers that follow it. */
interface Command {
  letter: string
  numbers: number[]
}

function parse(d: string): Command[] {
  const out: Command[] = []
  for (const [, letter, rest] of d.matchAll(/([a-zA-Z])([^a-zA-Z]*)/g)) {
    out.push({
      letter,
      numbers: (rest.match(/-?\d*\.?\d+/g) ?? []).map(Number),
    })
  }
  return out
}

/**
 * Arc parameters, with the flags split back out.
 *
 * `1110 0` is not four thousand-odd: it is flag, flag, then x. Reading it
 * the naive way is exactly the mistake this file exists to catch, so the
 * reader here does the digit-at-a-time walk the SVG grammar asks for.
 */
function arcGroups(rest: string): number[][] {
  const groups: number[][] = []
  let i = 0
  const number = /^[,\s]*(-?\d*\.?\d+)/
  const flag = /^[,\s]*([01])/

  while (i < rest.length) {
    const group: number[] = []
    for (const pattern of [number, number, number, flag, flag, number, number]) {
      const match = pattern.exec(rest.slice(i))
      if (!match) return [...groups, group] // short group: the caller fails on its length
      group.push(Number(match[1]))
      i += match[0].length
    }
    groups.push(group)
    if (!/\S/.test(rest.slice(i))) break
  }
  return groups
}

describe('the drawn icons', () => {
  it('has a path for every name', () => {
    expect(names.length).toBeGreaterThan(20)
    for (const name of names) expect(ICON_PATHS[name], name).toMatch(/\S/)
  })

  it('starts every path with a move', () => {
    for (const name of names) {
      expect(ICON_PATHS[name].trimStart()[0], name).toBe('M')
    }
  })

  it('draws its dots with a length Chrome will not throw away', () => {
    for (const name of names) {
      // A pin's centre, a train's windows, a snowflake: all drawn as a
      // capped segment going nowhere. The spec says a zero-length
      // subpath with a round cap renders as a dot; Chrome drops it, so
      // the whole first set of these was invisible on the phone and
      // perfectly fine in the source. `.01` is the smallest length that
      // survives, and looks identical.
      expect(ICON_PATHS[name], `${name}: a zero-length dot renders as nothing`).not.toMatch(
        /[hv]-?0(?![.\d])/,
      )
    }
  })

  it('stays inside the 24×24 grid', () => {
    for (const name of names) {
      for (const command of parse(ICON_PATHS[name])) {
        if (command.letter.toLowerCase() === 'a') continue // checked below
        for (const value of command.numbers) {
          // Absolute commands name a point in the box; relative ones name
          // a step, which cannot usefully be longer than the box either.
          expect(value, `${name}: ${command.letter}${value}`).toBeGreaterThanOrEqual(-24)
          expect(value, `${name}: ${command.letter}${value}`).toBeLessThanOrEqual(24)
        }
      }
    }
  })

  it('writes every arc with its seven parameters', () => {
    let arcs = 0
    for (const name of names) {
      for (const [, rest] of ICON_PATHS[name].matchAll(/[aA]([^a-zA-Z]*)/g)) {
        for (const group of arcGroups(rest)) {
          arcs += 1
          expect(group, `${name}: arc "${rest.trim()}"`).toHaveLength(7)
          const [rx, ry, , largeArc, sweep, x, y] = group
          expect(rx, `${name}: rx`).toBeGreaterThan(0)
          expect(ry, `${name}: ry`).toBeGreaterThan(0)
          expect([0, 1], `${name}: large-arc flag`).toContain(largeArc)
          expect([0, 1], `${name}: sweep flag`).toContain(sweep)
          expect(Math.abs(x), `${name}: arc end x`).toBeLessThanOrEqual(24)
          expect(Math.abs(y), `${name}: arc end y`).toBeLessThanOrEqual(24)
        }
      }
    }
    // Without this the loop above passes on a file with no arcs at all.
    expect(arcs).toBeGreaterThan(5)
  })
})
