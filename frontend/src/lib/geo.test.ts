import { describe, expect, it } from 'vitest'

import { haversineKm, routeMinutes, travelMinutes, travelMode } from './geo'

// Real Tokyo coordinates, so the numbers can be sanity-checked against a
// map rather than against themselves.
const SENSOJI = { lat: 35.7148, lon: 139.7967 }
const SKYTREE = { lat: 35.7101, lon: 139.8107 }   // ~1.3 km away
const SHIBUYA = { lat: 35.6595, lon: 139.7005 }   // ~11 km away

describe('distance', () => {
  it('measures a short hop across a neighbourhood', () => {
    expect(haversineKm(SENSOJI, SKYTREE)).toBeCloseTo(1.34, 1)
  })

  it('measures a trip across the city', () => {
    expect(haversineKm(SENSOJI, SHIBUYA)).toBeCloseTo(10.9, 0)
  })

  it('is zero between a place and itself', () => {
    expect(haversineKm(SENSOJI, SENSOJI)).toBe(0)
  })

  it('is symmetric', () => {
    expect(haversineKm(SENSOJI, SHIBUYA)).toBeCloseTo(haversineKm(SHIBUYA, SENSOJI), 6)
  })

  it('does not blow up on antipodes', () => {
    // Floating point can push the argument of asin just past 1.
    expect(haversineKm({ lat: 0, lon: 0 }, { lat: 0, lon: 180 })).toBeGreaterThan(20000)
    expect(Number.isNaN(haversineKm({ lat: 90, lon: 0 }, { lat: -90, lon: 0 }))).toBe(false)
  })
})

describe('how long it takes', () => {
  it('treats a few hundred metres as a walk', () => {
    const nearby = { lat: 35.7148, lon: 139.8 }
    expect(travelMode(SENSOJI, nearby)).toBe('walk')
    // Roughly 400 m with the detour factor: five minutes or so.
    expect(travelMinutes(SENSOJI, nearby)).toBeLessThan(10)
  })

  it('treats a trip across the city as transit, with its overhead', () => {
    expect(travelMode(SENSOJI, SHIBUYA)).toBe('transit')
    const minutes = travelMinutes(SENSOJI, SHIBUYA)
    // Sanity, not precision: Asakusa to Shibuya really is about 40 minutes
    // door to door, and the estimate should be in that region rather than
    // the 2h a straight walking calculation would give.
    expect(minutes).toBeGreaterThan(25)
    expect(minutes).toBeLessThan(75)
  })

  it('costs nothing to stay where you are', () => {
    expect(travelMinutes(SENSOJI, SENSOJI)).toBe(0)
  })

  it('never makes a longer distance cheaper than a shorter one', () => {
    // The property the ordering relies on. A model that inverted here would
    // happily produce a zig-zag and call it optimal.
    const near = travelMinutes(SENSOJI, SKYTREE)
    const far = travelMinutes(SENSOJI, SHIBUYA)
    expect(far).toBeGreaterThan(near)
  })

  it('adds up a route leg by leg', () => {
    const total = routeMinutes([SENSOJI, SKYTREE, SHIBUYA])
    expect(total).toBe(travelMinutes(SENSOJI, SKYTREE) + travelMinutes(SKYTREE, SHIBUYA))
  })

  it('is zero for a route of one stop', () => {
    expect(routeMinutes([SENSOJI])).toBe(0)
  })
})
