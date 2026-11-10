import { describe, expect, it } from 'vitest'
import {
  GARDEN_STAGES,
  STAGE_BLOOM_MIN,
  STAGE_SPROUT_MAX,
  VITALITY_MAX,
  VITALITY_MIN,
  VITALITY_MISS_DELTA,
  VITALITY_PASS_DELTA,
  VITALITY_START,
  applyDayResult,
  clampVitality,
  gardenStage,
  gardenStatusText,
  roundVitality,
  stageName,
  type GardenStage,
  type GardenState,
} from '../src/garden.ts'
import type { PactStatus } from '../src/schemas.ts'

function state(overrides: Partial<GardenState> = {}): GardenState {
  return { vitality: 0.5, status: 'ACTIVE', hasProof: true, wilting: false, ...overrides }
}

describe('vitality arithmetic', () => {
  it('starts at the blueprint value', () => {
    expect(VITALITY_START).toBe(0.15)
  })

  it('adds on a pass and subtracts on a miss', () => {
    expect(applyDayResult(0.5, true)).toBe(roundVitality(0.5 + VITALITY_PASS_DELTA))
    expect(applyDayResult(0.5, false)).toBe(roundVitality(0.5 + VITALITY_MISS_DELTA))
  })

  it('never leaves the range the database CHECK enforces', () => {
    expect(applyDayResult(0.95, true)).toBe(VITALITY_MAX)
    expect(applyDayResult(0.1, false)).toBe(VITALITY_MIN)
    expect(clampVitality(-3)).toBe(VITALITY_MIN)
    expect(clampVitality(9)).toBe(VITALITY_MAX)
  })

  it('treats a non-finite value as the floor rather than propagating NaN', () => {
    expect(clampVitality(Number.NaN)).toBe(VITALITY_MIN)
    expect(clampVitality(Number.POSITIVE_INFINITY)).toBe(VITALITY_MIN)
  })

  // The column is double precision. Without rounding, 0.15 + 0.18 is
  // 0.32999999999999996, and a value resting on a stage boundary could render
  // differently depending on which code path produced it.
  it('is exact at the boundaries despite binary floating point', () => {
    expect(applyDayResult(VITALITY_START, true)).toBe(0.33)
    expect(0.15 + 0.18).not.toBe(0.33)
    let v = VITALITY_START
    for (let i = 0; i < 5; i++) v = applyDayResult(v, true)
    expect(v).toBe(1)
  })

  it('is idempotent under repeated rounding', () => {
    for (const v of [0, 0.15, 0.33, 0.35, 0.7, 1]) {
      expect(roundVitality(roundVitality(v))).toBe(roundVitality(v))
    }
  })
})

describe('gardenStage', () => {
  it('lets a settled failure wither the plant regardless of vitality', () => {
    expect(gardenStage(state({ status: 'SETTLED_FAIL', vitality: 1 }))).toBe('withered')
  })

  it('lets a settled pass bloom even below the bloom threshold', () => {
    expect(gardenStage(state({ status: 'SETTLED_PASS', vitality: 0.2 }))).toBe('bloom')
  })

  it('shows a seed until the stake is captured', () => {
    for (const status of ['DRAFT', 'AWAITING_STAKE', 'CANCELLED_REFUNDED', 'EXPIRED'] as PactStatus[]) {
      expect(gardenStage(state({ status, vitality: 0.9 }))).toBe('seed')
    }
  })

  it('shows a seed for a funded pact with no proof yet', () => {
    expect(gardenStage(state({ hasProof: false, vitality: 0.9 }))).toBe('seed')
  })

  it('wilts when a miss just landed, ahead of the vitality band', () => {
    expect(gardenStage(state({ wilting: true, vitality: 0.9 }))).toBe('wilting')
  })

  it('maps the vitality bands at their exact boundaries', () => {
    expect(gardenStage(state({ vitality: 0.3499 }))).toBe('sprout')
    expect(gardenStage(state({ vitality: STAGE_SPROUT_MAX }))).toBe('growing')
    expect(gardenStage(state({ vitality: 0.6999 }))).toBe('growing')
    expect(gardenStage(state({ vitality: STAGE_BLOOM_MIN }))).toBe('bloom')
  })

  it('keeps deriving from vitality while settling or under review', () => {
    expect(gardenStage(state({ status: 'SETTLING', vitality: 0.8 }))).toBe('bloom')
    expect(gardenStage(state({ status: 'NEEDS_REVIEW', vitality: 0.2 }))).toBe('sprout')
  })

  it('only ever returns a known stage', () => {
    for (const vitality of [0, 0.2, 0.35, 0.5, 0.7, 1]) {
      for (const status of ['ACTIVE', 'SETTLING', 'SETTLED_PASS', 'SETTLED_FAIL'] as PactStatus[]) {
        expect(GARDEN_STAGES).toContain(gardenStage(state({ vitality, status })))
      }
    }
  })
})

describe('status text', () => {
  it('names every stage', () => {
    for (const stage of GARDEN_STAGES) expect(stageName(stage)).toBeTruthy()
  })

  it('reads as the blueprint example', () => {
    const stage: GardenStage = 'bloom'
    expect(gardenStatusText(stage, 4, 7)).toBe('Bloom · 4 of 7 days verified')
  })
})
