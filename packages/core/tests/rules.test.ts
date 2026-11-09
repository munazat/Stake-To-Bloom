import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { settle, type SettleMember, type SettleInput } from '../src/rules.ts'

function member(overrides: Partial<SettleMember> & { pactId: string }): SettleMember {
  return {
    userId: null,
    isSim: false,
    stakeCents: 2000,
    passes: 5,
    requiredPasses: 5,
    payerEmail: null,
    ...overrides,
  }
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

describe('settle() — worked examples', () => {
  it('splits the forfeit when a real winner and a sim winner both pass', () => {
    const input: SettleInput = {
      poolIsDemo: true,
      charityEmail: 'charity@example.com',
      members: [
        member({ pactId: 'pact-you', userId: 'u1', stakeCents: 2000, passes: 6, payerEmail: 'you@example.com' }),
        member({ pactId: 'pact-sim-win', isSim: true, stakeCents: 2000, passes: 6 }),
        member({ pactId: 'pact-sim-lose-a', isSim: true, stakeCents: 2000, passes: 1 }),
        member({ pactId: 'pact-sim-lose-b', isSim: true, stakeCents: 2000, passes: 2 }),
      ],
    }
    const r = settle(input)
    expect(r.winnerPactIds).toEqual(['pact-sim-win', 'pact-you'])
    expect(r.loserPactIds).toEqual(['pact-sim-lose-a', 'pact-sim-lose-b'])
    expect(r.forfeitCents).toBe(4000)
    expect(r.payouts).toHaveLength(2) // real + sim winner, for conservation
    expect(r.items).toHaveLength(1) // only the real winner moves PayPal money
    expect(r.items[0].pactId).toBe('pact-you')
    expect(r.items[0].recipientEmail).toBe('you@example.com')
    expect(r.items[0].amountCents).toBe(4000) // stake 2000 + bonus 2000
    expect(r.charityCents).toBe(0)
    expect(r.unmovedSimForfeitCents).toBe(0)
    expect(sum(r.payouts.map((p) => p.amountCents))).toBe(8000)
  })

  it('routes real forfeit to charity and moves nothing for sims when nobody wins', () => {
    const input: SettleInput = {
      poolIsDemo: true,
      charityEmail: 'charity@example.com',
      members: [
        member({ pactId: 'pact-you', userId: 'u1', stakeCents: 2000, passes: 1, payerEmail: 'you@example.com' }),
        member({ pactId: 'pact-sim', isSim: true, stakeCents: 2000, passes: 2 }),
      ],
    }
    const r = settle(input)
    expect(r.winnerPactIds).toEqual([])
    expect(r.payouts).toEqual([])
    expect(r.items).toEqual([])
    expect(r.charityCents).toBe(2000)
    expect(r.charityEmail).toBe('charity@example.com')
    expect(r.unmovedSimForfeitCents).toBe(2000)
    expect(r.charityCents + r.unmovedSimForfeitCents).toBe(4000)
  })

  it('hands leftover cents to the first winners by pact id', () => {
    const input: SettleInput = {
      poolIsDemo: true,
      charityEmail: null,
      members: [
        member({ pactId: 'w1', stakeCents: 1000, passes: 5, payerEmail: 'w1@example.com' }),
        member({ pactId: 'w2', stakeCents: 1000, passes: 5, payerEmail: 'w2@example.com' }),
        member({ pactId: 'w3', stakeCents: 1000, passes: 5, payerEmail: 'w3@example.com' }),
        member({ pactId: 'loser', stakeCents: 10, passes: 0, payerEmail: 'l@example.com' }),
      ],
    }
    const r = settle(input)
    expect(r.forfeitCents).toBe(10)
    // share = 3, remainder = 1 -> first winner (by pact id) gets the extra cent.
    expect(r.payouts.map((p) => p.amountCents)).toEqual([1004, 1003, 1003])
    expect(sum(r.payouts.map((p) => p.amountCents))).toBe(3010)
  })
})

describe('settle() — invariant guards', () => {
  it('I6: refuses a simulated member in a non-demo pool', () => {
    expect(() =>
      settle({
        poolIsDemo: false,
        charityEmail: null,
        members: [member({ pactId: 'sim', isSim: true, passes: 5 })],
      }),
    ).toThrow(/I6/)
  })

  it('I2: refuses a real winner with no payerEmail from capture', () => {
    expect(() =>
      settle({
        poolIsDemo: false,
        charityEmail: null,
        members: [member({ pactId: 'you', userId: 'u1', passes: 5, payerEmail: null })],
      }),
    ).toThrow(/payerEmail/)
  })

  it('requires a charityEmail when a real forfeit exists and nobody wins', () => {
    expect(() =>
      settle({
        poolIsDemo: false,
        charityEmail: null,
        members: [member({ pactId: 'you', userId: 'u1', passes: 0, payerEmail: 'you@example.com' })],
      }),
    ).toThrow(/charityEmail/)
  })

  it('rejects empty pools and non-positive stakes', () => {
    expect(() => settle({ poolIsDemo: true, charityEmail: null, members: [] })).toThrow()
    expect(() =>
      settle({
        poolIsDemo: true,
        charityEmail: null,
        members: [member({ pactId: 'x', stakeCents: 0, passes: 5 })],
      }),
    ).toThrow()
  })
})

describe('settle() — property tests', () => {
  const seedArb = fc.record({
    stakeCents: fc.integer({ min: 1, max: 100_000 }),
    passes: fc.integer({ min: 0, max: 7 }),
    requiredPasses: fc.integer({ min: 1, max: 7 }),
    isSim: fc.boolean(),
  })

  const membersArb = fc.array(seedArb, { minLength: 1, maxLength: 12 }).map((seeds) =>
    seeds.map((s, i): SettleMember => ({
      pactId: 'p' + String(i).padStart(3, '0'),
      userId: s.isSim ? null : 'u' + i,
      isSim: s.isSim,
      stakeCents: s.stakeCents,
      passes: s.passes,
      requiredPasses: s.requiredPasses,
      payerEmail: s.isSim ? null : `payer${i}@example.com`,
    })),
  )

  const inputFor = (members: SettleMember[]): SettleInput => ({
    poolIsDemo: true,
    charityEmail: 'charity@example.com',
    members,
  })

  it('conserves every cent; losers are never paid; winners get at least their stake', () => {
    fc.assert(
      fc.property(membersArb, (members) => {
        const r = settle(inputFor(members))
        const totalIn = sum(members.map((m) => m.stakeCents))
        const totalOut =
          sum(r.payouts.map((p) => p.amountCents)) + r.charityCents + r.unmovedSimForfeitCents
        // I: not one cent created or destroyed.
        expect(totalOut).toBe(totalIn)
        // Payouts never exceed money-in.
        expect(sum(r.payouts.map((p) => p.amountCents))).toBeLessThanOrEqual(totalIn)
        // Every amount is a non-negative safe integer.
        for (const p of r.payouts) {
          expect(Number.isInteger(p.amountCents)).toBe(true)
          expect(p.amountCents).toBeGreaterThanOrEqual(0)
        }
        // Only winners appear in payouts, and each gets >= their own stake back.
        const byId = new Map(members.map((m) => [m.pactId, m]))
        for (const p of r.payouts) {
          const m = byId.get(p.pactId)!
          expect(m.passes >= m.requiredPasses).toBe(true)
          expect(p.amountCents).toBeGreaterThanOrEqual(m.stakeCents)
        }
        // Losers are never paid.
        for (const id of r.loserPactIds) {
          expect(r.payouts.some((p) => p.pactId === id)).toBe(false)
        }
        // Real payouts (items) exclude simulated winners and always carry a recipient.
        for (const item of r.items) {
          expect(item.isSim).toBe(false)
          expect(typeof item.recipientEmail).toBe('string')
        }
      }),
      { numRuns: 1000 },
    )
  })

  it('is deterministic regardless of member input order', () => {
    fc.assert(
      fc.property(membersArb, (members) => {
        const a = settle(inputFor(members))
        const b = settle(inputFor([...members].reverse()))
        expect(b).toEqual(a)
      }),
      { numRuns: 500 },
    )
  })
})
