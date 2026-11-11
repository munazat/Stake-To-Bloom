import {
  sha256Hex,
  canonicalJson,
  settle,
  type SettleInput,
  type SettleResult,
} from '../_shared/core/index.ts'
import { HttpError } from '../_shared/http.ts'
import { assertPayoutSafe, type PayoutGuardInput } from '../_shared/guard.ts'
import type { PaypalClient } from '../_shared/paypal.ts'

export interface SettlementDeps {
  paypal: PaypalClient
  transition(ids: string[], from: string, to: string): Promise<boolean>
  load(id: string): Promise<{
    status: string
    settlementEnabled: boolean
    paymentsEnabled: boolean
    payoutExists: boolean
    input: SettleInput
    guard: Omit<PayoutGuardInput, 'plan' | 'expectedPlanHash' | 'storedPlanHash'>
  } | null>
  savePlan(id: string, plan: SettleResult, hash: string, batchId: string): Promise<void>
  markReview(id: string, hash: string): Promise<void>
  markSubmitted(id: string, hash: string, batchId: string, payoutId: string): Promise<void>
  completeNoPayout(id: string, plan: SettleResult, hash: string, batchId: string): Promise<void>
}

export async function settlePact(
  deps: SettlementDeps,
  id: string,
  caller: PayoutGuardInput['caller'],
): Promise<{ status: string; batchId: string }> {
  const loaded = await deps.load(id)
  if (!loaded) throw new HttpError(404, 'pact_not_found', 'Pact not found.')
  if (loaded.status === 'SETTLED_PASS' || loaded.status === 'SETTLED_FAIL')
    return { status: loaded.status, batchId: '' }
  const pactIds = loaded.input.members.map((member) => member.pactId)
  if (!(await deps.transition(pactIds, loaded.status, 'SETTLING')))
    throw new HttpError(409, 'settlement_race', 'Another settlement worker is handling this pact.')
  let plan: SettleResult | null = null
  let hash = ''
  const batchId = `bloom-settle-${id}`
  try {
    plan = settle(loaded.input)
    hash = await sha256Hex(canonicalJson(plan))
    await deps.savePlan(id, plan, hash, batchId)
    await assertPayoutSafe({
      ...loaded.guard,
      plan,
      expectedPlanHash: hash,
      storedPlanHash: hash,
      status: 'SETTLING',
      hasEarlierPayout: loaded.payoutExists,
      caller,
    })
    if (plan.items.length === 0 && plan.charityCents === 0) {
      await deps.completeNoPayout(id, plan, hash, batchId)
      return { status: 'NO_PAYOUT', batchId }
    }
    const result = await deps.paypal.createPayout({
      batchId,
      items: [
        ...plan.items.map((i, n) => ({
          id: `bloom-${id}-${n}`,
          email: i.recipientEmail!,
          amountCents: i.amountCents,
        })),
        ...(plan.charityCents > 0
          ? [
              {
                id: `bloom-${id}-charity`,
                email: plan.charityEmail!,
                amountCents: plan.charityCents,
              },
            ]
          : []),
      ],
    })
    await deps.markSubmitted(id, hash, batchId, result.batchId)
    return { status: result.status, batchId: result.batchId }
  } catch (error) {
    await deps.markReview(id, hash).catch(() => undefined)
    await deps.transition(pactIds, 'SETTLING', 'NEEDS_REVIEW').catch(() => false)
    throw error
  }
}
