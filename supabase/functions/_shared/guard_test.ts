import assert from 'node:assert/strict'
import { assertPayoutSafe, type PayoutGuardInput } from './guard.ts'
import { sha256Hex, canonicalJson } from './core/index.ts'

const plan = {
  items: [{ pactId: 'p1', amountCents: 700, recipientEmail: 'buyer@example.test' }],
  charityCents: 0,
  charityEmail: null,
}
async function input(): Promise<PayoutGuardInput> {
  const copy = structuredClone(plan)
  const hash = await sha256Hex(canonicalJson(copy))
  return {
    plan: copy,
    expectedPlanHash: hash,
    storedPlanHash: hash,
    status: 'SETTLING',
    hasEarlierPayout: false,
    expectedRecipients: { p1: 'buyer@example.test' },
    charityEmail: null,
    ledgerStakeCents: 1000,
    simulatedForfeitCents: 0,
    isDemo: false,
    ruleHashesMatch: true,
    closedDayCount: 7,
    requiredDayCount: 7,
    settlementEnabled: true,
    paymentsEnabled: true,
    sandbox: true,
    caller: 'cron',
    demoOwner: false,
  }
}

Deno.test('payout guard accepts a sandbox plan under the captured-stake limit', async () =>
  assert.doesNotReject(() => input().then(assertPayoutSafe)),
)
Deno.test('payout guard refuses recipient substitution', async () => {
  const value = await input()
  value.plan.items[0].recipientEmail = 'attacker@example.test'
  await assert.rejects(() => assertPayoutSafe(value), { code: 'recipient_mismatch' })
})
Deno.test('payout guard refuses over-cap items and batches', async () => {
  const value = await input()
  value.plan.items[0].amountCents = 20_001
  await assert.rejects(() => assertPayoutSafe(value), { code: 'payout_cap' })
})
Deno.test('payout guard refuses stale status, plan, or unfrozen rule', async () => {
  const value = await input()
  value.status = 'ACTIVE'
  await assert.rejects(() => assertPayoutSafe(value), { code: 'settlement_state' })
  const stale = await input()
  stale.ruleHashesMatch = false
  await assert.rejects(() => assertPayoutSafe(stale), { code: 'rule_hash_mismatch' })
  const tampered = await input()
  tampered.expectedPlanHash = '0'.repeat(64)
  await assert.rejects(() => assertPayoutSafe(tampered), { code: 'plan_hash_mismatch' })
})
Deno.test('payout guard refuses early settlement and missing switches', async () => {
  const value = await input()
  value.closedDayCount = 6
  await assert.rejects(() => assertPayoutSafe(value), { code: 'days_open' })
  const disabled = await input()
  disabled.settlementEnabled = false
  await assert.rejects(() => assertPayoutSafe(disabled), { code: 'settlement_disabled' })
})
