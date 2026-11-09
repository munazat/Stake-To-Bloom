/**
 * rules.ts — settle(): the deterministic money engine (blueprint §6.6).
 *
 * PURE: no network, no clock, no randomness. Given the same members it always
 * returns the same plan. The AI never touches this. Every amount is integer cents.
 *
 * Model:
 *  - winners = members with passes >= requiredPasses; losers = the rest.
 *  - forfeit = sum of ALL losers' stakes.
 *  - If there are winners: each winner gets their own stake back + an equal share
 *    of the forfeit, with the leftover cents handed to the first winners by pactId.
 *    Only REAL winners become actual PayPal payout `items`; simulated winners are
 *    counted as `payouts` (virtual) so conservation is exact but move no money.
 *  - If nobody wins: real losers' stakes go to charity; simulated forfeits move
 *    nothing (tracked explicitly as unmovedSimForfeitCents).
 *
 * Conservation invariant (property-tested): sum(payouts) + charityCents +
 * unmovedSimForfeitCents === sum(all member stakes). Not one cent created or lost.
 */
import { assertCents, sumCents } from './money.ts'

export interface SettleMember {
  pactId: string
  userId: string | null
  isSim: boolean
  stakeCents: number
  passes: number
  requiredPasses: number
  /** The payer email captured from this pact's own PayPal capture (invariant I2). */
  payerEmail: string | null
}

export interface SettleInput {
  members: SettleMember[]
  charityEmail: string | null
  poolIsDemo: boolean
}

export interface PayoutLine {
  pactId: string
  isSim: boolean
  amountCents: number
  /** Real payouts only; null for simulated winners. */
  recipientEmail: string | null
}

export interface SettleResult {
  winnerPactIds: string[]
  loserPactIds: string[]
  forfeitCents: number
  /** All winners (real + simulated), deterministic order — for conservation + receipt. */
  payouts: PayoutLine[]
  /** Real winners only — the actual PayPal Payouts items. */
  items: PayoutLine[]
  charityCents: number
  charityEmail: string | null
  unmovedSimForfeitCents: number
  /** Ordered, human-readable steps that feed the "Why this payout?" receipt. */
  trace: string[]
}

function byPactId(a: SettleMember, b: SettleMember): number {
  return a.pactId < b.pactId ? -1 : a.pactId > b.pactId ? 1 : 0
}

export function settle(input: SettleInput): SettleResult {
  const { members, charityEmail, poolIsDemo } = input
  if (members.length === 0) throw new RangeError('settle() requires at least one member')

  for (const m of members) {
    assertCents(m.stakeCents, 'stakeCents')
    if (m.stakeCents <= 0) throw new RangeError(`stakeCents must be > 0 (pact ${m.pactId})`)
    if (!Number.isInteger(m.passes) || m.passes < 0) throw new RangeError(`passes must be a non-negative integer (pact ${m.pactId})`)
    // Invariant I6: simulated-peer money is allowed only in a demo pool.
    if (m.isSim && !poolIsDemo) throw new Error(`simulated member ${m.pactId} in a non-demo pool violates invariant I6`)
  }

  const trace: string[] = []
  const sorted = [...members].sort(byPactId)
  const winners = sorted.filter((m) => m.passes >= m.requiredPasses)
  const losers = sorted.filter((m) => m.passes < m.requiredPasses)
  const winnerPactIds = winners.map((m) => m.pactId)
  const loserPactIds = losers.map((m) => m.pactId)
  const forfeitCents = sumCents(losers.map((m) => m.stakeCents))

  trace.push(`${winners.length} of ${members.length} member(s) reached their required verified days.`)

  // ---- Case B: nobody wins -> forfeit to charity (real money only) ----------
  if (winners.length === 0) {
    const realLosers = losers.filter((m) => !m.isSim)
    const simLosers = losers.filter((m) => m.isSim)
    const charityCents = sumCents(realLosers.map((m) => m.stakeCents))
    const unmovedSimForfeitCents = sumCents(simLosers.map((m) => m.stakeCents))
    if (charityCents > 0 && !charityEmail) {
      throw new Error('charityEmail is required when a real forfeit exists and there are no winners')
    }
    trace.push(
      charityCents > 0
        ? `No winners. Real forfeit of ${charityCents} cent(s) goes to charity (${charityEmail}).`
        : 'No winners and no real money to forfeit.',
    )
    if (unmovedSimForfeitCents > 0) {
      trace.push(`Simulated forfeit of ${unmovedSimForfeitCents} cent(s) moves no money.`)
    }
    return {
      winnerPactIds,
      loserPactIds,
      forfeitCents,
      payouts: [],
      items: [],
      charityCents,
      charityEmail: charityCents > 0 ? charityEmail : null,
      unmovedSimForfeitCents,
      trace,
    }
  }

  // ---- Case A: at least one winner -> split the forfeit ---------------------
  const n = winners.length
  const share = Math.floor(forfeitCents / n)
  const remainder = forfeitCents - share * n
  trace.push(
    `Forfeit pool of ${forfeitCents} cent(s) split across ${n} winner(s): ${share} cent(s) each` +
      (remainder > 0 ? `, plus ${remainder} leftover cent(s) to the first winner(s) by pact id.` : '.'),
  )

  const payouts: PayoutLine[] = winners.map((m, i) => {
    const bonus = share + (i < remainder ? 1 : 0)
    const amountCents = assertCents(m.stakeCents + bonus, 'payout amount')
    if (!m.isSim && !m.payerEmail) {
      // Invariant I2: recipient comes only from this pact's own capture response.
      throw new Error(`real winner ${m.pactId} has no payerEmail from capture; refusing to guess a recipient`)
    }
    trace.push(
      `Winner ${m.pactId}${m.isSim ? ' (demo player)' : ''}: stake ${m.stakeCents} + bonus ${bonus} = ${amountCents} cent(s).`,
    )
    return { pactId: m.pactId, isSim: m.isSim, amountCents, recipientEmail: m.isSim ? null : m.payerEmail }
  })

  const items = payouts.filter((p) => !p.isSim)

  return {
    winnerPactIds,
    loserPactIds,
    forfeitCents,
    payouts,
    items,
    charityCents: 0,
    charityEmail: null,
    unmovedSimForfeitCents: 0,
    trace,
  }
}
