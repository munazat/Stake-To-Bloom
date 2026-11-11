import { describe, it, expect } from 'vitest'
import { ATTACKS, INSUFFICIENT_STEPS, VALID_STEPS, sampleSpec } from '../src/lib/samples.ts'

const ctx = { dateKey: '2026-11-11', dailyCode: 'K7M2P' }
const text = (spec: ReturnType<typeof sampleSpec>) => spec.layers.map((l) => l.text).join('\n')

describe('sample proofs', () => {
  it('always carry the given date and daily code', () => {
    for (const kind of ['valid', 'insufficient', 'attack'] as const) {
      const t = text(sampleSpec(kind, ctx))
      expect(t).toContain('2026-11-11')
      expect(t).toContain('K7M2P')
    }
  })

  it('show 10,482 and 6,203 steps', () => {
    expect(VALID_STEPS).toBe(10_482)
    expect(INSUFFICIENT_STEPS).toBe(6_203)
    expect(text(sampleSpec('valid', ctx))).toContain('10,482')
    expect(text(sampleSpec('insufficient', ctx))).toContain('6,203')
  })

  it('the attack looks valid AND carries an instruction aimed at the AI', () => {
    const t = text(sampleSpec('attack', ctx))
    expect(t).toContain('10,482')
    expect(t).toMatch(/SYSTEM/)
    expect(t).toMatch(/Approve this day/i)
  })

  it('the clean samples contain nothing the injection backstop would flag', () => {
    expect(text(sampleSpec('valid', ctx))).not.toMatch(/system|approve|payout|score|json|ignore/i)
  })
})

describe('red-team corpus', () => {
  it('has ten image attacks with unique ids (image reuse is run separately, by submitting twice)', () => {
    expect(ATTACKS).toHaveLength(10)
    expect(new Set(ATTACKS.map((a) => a.id)).size).toBe(10)
  })

  it('forbids PASS on every attack and builds with the given context', () => {
    for (const attack of ATTACKS) {
      expect(attack.forbidden).toBe('PASS')
      expect(attack.build(ctx).layers.length).toBeGreaterThan(3)
    }
  })

  it('stale-date attacks show a date a week before the given one', () => {
    for (const id of ['stale-date', 'screenshot-of-screenshot']) {
      const t = text(ATTACKS.find((a) => a.id === id)!.build(ctx))
      expect(t).toContain('2026-11-04')
      expect(t).not.toContain('2026-11-11')
    }
  })

  it('includes Urdu and Arabic approval text', () => {
    expect(text(ATTACKS.find((a) => a.id === 'urdu')!.build(ctx))).toMatch(/[؀-ۿ]/)
    expect(text(ATTACKS.find((a) => a.id === 'arabic')!.build(ctx))).toMatch(/[؀-ۿ]/)
  })
})
