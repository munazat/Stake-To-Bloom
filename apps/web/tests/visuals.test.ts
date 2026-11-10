import { describe, it, expect } from 'vitest'
import { GARDEN_STAGES } from '@bloomstake/core'
import { PLANT_REFERENCE_HEIGHT, daylightColor, moodIntensity, plantLook } from '../src/garden/visuals.ts'

const HEX = /^#[0-9a-f]{6}$/

describe('plantLook', () => {
  it('gives every stage a complete look with valid colours', () => {
    for (const stage of GARDEN_STAGES) {
      const look = plantLook(stage, 0.5)
      expect(look.stemHeight).toBeGreaterThanOrEqual(0)
      expect(look.stemHeight).toBeLessThanOrEqual(PLANT_REFERENCE_HEIGHT)
      expect(look.stemBend).toBeGreaterThanOrEqual(0)
      expect(look.stemBend).toBeLessThanOrEqual(1)
      expect(look.petalOpen).toBeGreaterThanOrEqual(0)
      expect(look.petalOpen).toBeLessThanOrEqual(1)
      expect(look.stemColor).toMatch(HEX)
      expect(look.leafColor).toMatch(HEX)
      expect(look.petalColor).toMatch(HEX)
    }
  })

  it('draws nothing above the soil for a seed', () => {
    const look = plantLook('seed', 0.15)
    expect(look.stemHeight).toBe(0)
    expect(look.leafCount).toBe(0)
    expect(look.petalOpen).toBe(0)
  })

  it('opens petals only once the plant blooms', () => {
    expect(plantLook('sprout', 0.2).petalOpen).toBe(0)
    expect(plantLook('growing', 0.5).petalOpen).toBeLessThan(0.5)
    expect(plantLook('bloom', 0.8).petalOpen).toBe(1)
  })

  it('grows taller as vitality rises', () => {
    const heights = [0.1, 0.3, 0.45, 0.6, 0.8, 1].map((v) => plantLook('growing', v).stemHeight)
    for (let i = 1; i < heights.length; i += 1) {
      expect(heights[i]!).toBeGreaterThanOrEqual(heights[i - 1]!)
    }
  })

  it('droops and drains colour when wilting, but keeps its height', () => {
    const healthy = plantLook('growing', 0.5)
    const wilting = plantLook('wilting', 0.5)
    expect(wilting.leafDroop).toBeGreaterThan(healthy.leafDroop)
    expect(wilting.stemBend).toBeGreaterThan(healthy.stemBend)
    expect(wilting.stemHeight).toBe(healthy.stemHeight)
    expect(wilting.leafColor).not.toBe(healthy.leafColor)
  })

  it('collapses a withered plant regardless of the vitality it settled on', () => {
    const look = plantLook('withered', 1)
    expect(look.stemBend).toBe(1)
    expect(look.leafDroop).toBe(1)
    expect(look.petalOpen).toBe(0)
    expect(look.stemHeight).toBeLessThan(PLANT_REFERENCE_HEIGHT)
  })

  it('never grows more leaves than the blueprint describes', () => {
    for (const stage of GARDEN_STAGES) {
      for (const v of [0, 0.2, 0.5, 0.7, 1]) {
        expect(plantLook(stage, v).leafCount).toBeLessThanOrEqual(6)
      }
    }
  })

  it('treats out-of-range vitality as clamped rather than throwing', () => {
    expect(plantLook('growing', -5)).toEqual(plantLook('growing', 0))
    expect(plantLook('bloom', 9)).toEqual(plantLook('bloom', 1))
    expect(plantLook('growing', Number.NaN).stemColor).toMatch(HEX)
  })

  it('is deterministic, so the two renderers cannot disagree', () => {
    expect(plantLook('bloom', 0.83)).toEqual(plantLook('bloom', 0.83))
  })
})

describe('light', () => {
  it('returns a valid colour for every hour of the day', () => {
    for (let hour = 0; hour < 24; hour += 1) {
      expect(daylightColor(hour)).toMatch(HEX)
    }
  })

  it('dims the scene for a struggling plant and brightens a bloom', () => {
    expect(moodIntensity('wilting')).toBeLessThan(moodIntensity('growing'))
    expect(moodIntensity('withered')).toBeLessThan(moodIntensity('growing'))
    expect(moodIntensity('bloom')).toBeGreaterThan(moodIntensity('growing'))
  })
})