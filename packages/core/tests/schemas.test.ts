import { describe, it, expect } from 'vitest'
import {
  RuleSpecSchema,
  ObservationSchema,
  ObservationCheckSchema,
  normalizeBox,
} from '../src/schemas.ts'
import { stepsSpec, waterSpec, mealSpec, workoutSpec } from '../src/templates.ts'
import type { RuleSpec } from '../src/schemas.ts'

describe('RuleSpecSchema', () => {
  it('accepts every built-in template', () => {
    for (const spec of [stepsSpec(), waterSpec(), mealSpec(), workoutSpec()]) {
      expect(RuleSpecSchema.safeParse(spec).success).toBe(true)
    }
  })

  it('rejects out-of-bounds numeric thresholds per goal type', () => {
    expect(RuleSpecSchema.safeParse(stepsSpec({ threshold: 100 })).success).toBe(false)
    expect(RuleSpecSchema.safeParse(stepsSpec({ threshold: 999_999 })).success).toBe(false)
    expect(RuleSpecSchema.safeParse(waterSpec({ threshold: 100 })).success).toBe(false)
    // In-bounds values still pass.
    expect(RuleSpecSchema.safeParse(stepsSpec({ threshold: 12_000 })).success).toBe(true)
  })

  it('rejects requiredPasses outside 4..7', () => {
    expect(RuleSpecSchema.safeParse(stepsSpec({ requiredPasses: 3 })).success).toBe(false)
    expect(RuleSpecSchema.safeParse(stepsSpec({ requiredPasses: 8 })).success).toBe(false)
    expect(RuleSpecSchema.safeParse(stepsSpec({ requiredPasses: 4 })).success).toBe(true)
    expect(RuleSpecSchema.safeParse(stepsSpec({ requiredPasses: 7 })).success).toBe(true)
  })

  it('rejects a meal goal that uses a numeric check', () => {
    const bad: RuleSpec = { ...stepsSpec(), goalType: 'meal' }
    expect(RuleSpecSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects more than 3 checks', () => {
    const one = stepsSpec().checks[0]
    const many = { ...stepsSpec(), checks: [one, { ...one, id: 'c2' }, { ...one, id: 'c3' }, { ...one, id: 'c4' }] }
    expect(RuleSpecSchema.safeParse(many).success).toBe(false)
  })

  it('rejects a numeric check missing its comparator/threshold', () => {
    const bad = {
      ...stepsSpec(),
      checks: [{ id: 'x', kind: 'numeric' as const, description: 'no comparator or threshold' }],
    }
    expect(RuleSpecSchema.safeParse(bad).success).toBe(false)
  })
})

describe('ObservationSchema defaults', () => {
  it('fills safe defaults for untrusted AI output', () => {
    const obs = ObservationSchema.parse({ imageKind: 'screenshot' })
    expect(obs.transcript).toBe('')
    expect(obs.injectionDetected).toBe(false)
    expect(obs.checks).toEqual([])
    expect(obs.tamperSignals).toEqual([])
  })

  it('defaults a check confidence to 0.5 and evidenceText to ""', () => {
    const check = ObservationCheckSchema.parse({ id: 'steps', found: true })
    expect(check.confidence).toBe(0.5)
    expect(check.evidenceText).toBe('')
  })

  it('rejects a transcript over 600 chars', () => {
    expect(ObservationSchema.safeParse({ imageKind: 'photo', transcript: 'a'.repeat(601) }).success).toBe(false)
  })
})

describe('normalizeBox', () => {
  it('clamps to the 0..1000 scale', () => {
    expect(normalizeBox([-10, 20, 1200, 800])).toEqual([0, 20, 1000, 800])
  })

  it('drops an inverted box', () => {
    // ymax (200) < ymin (800) -> malformed.
    expect(normalizeBox([800, 100, 200, 900])).toBeNull()
  })

  it('drops null / malformed input', () => {
    expect(normalizeBox(null)).toBeNull()
    expect(normalizeBox(undefined)).toBeNull()
  })
})
