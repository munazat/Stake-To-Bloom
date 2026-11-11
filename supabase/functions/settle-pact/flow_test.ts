import assert from 'node:assert/strict'
import { sha256Hex, canonicalJson } from '../_shared/core/index.ts'
import { fakePaypal, USER } from '../_shared/testkit.ts'
import { settlePact, type SettlementDeps } from './flow.ts'

function setup() {
  const paypal = fakePaypal()
  const saved: unknown[] = []
  const guard = {
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
    caller: 'cron' as const,
    demoOwner: false,
    status: 'SETTLING',
    hasEarlierPayout: false,
  }
  let status = 'ACTIVE'
  const deps: SettlementDeps = {
    paypal,
    async transition(_ids, from, to) {
      if (status !== from) return false
      status = to
      return true
    },
    async load() {
      return {
        status,
        settlementEnabled: true,
        paymentsEnabled: true,
        payoutExists: false,
        input: {
          members: [
            {
              pactId: 'p1',
              userId: USER,
              isSim: false,
              stakeCents: 1000,
              passes: 7,
              requiredPasses: 4,
              payerEmail: 'buyer@example.test',
            },
          ],
          charityEmail: null,
          poolIsDemo: false,
        },
        guard,
      }
    },
    async savePlan(_id, payoutPlan, hash, batchId) {
      saved.push({ payoutPlan, hash, batchId })
    },
    async markReview() {},
    async markSubmitted() {},
    async completeNoPayout() {},
  }
  return { deps, paypal, saved, getStatus: () => status }
}

Deno.test(
  'settle-pact persists its deterministic plan then submits one idempotent payout',
  async () => {
    const { deps, paypal, saved } = setup()
    const result = await settlePact(deps, 'p1', 'cron')
    assert.equal(result.status, 'SUCCESS')
    assert.equal(saved.length, 1)
    assert.equal(paypal.calls.filter((c) => c === 'payout').length, 1)
  },
)

Deno.test('two concurrent settlement calls have one compare-and-set winner', async () => {
  const { deps, paypal } = setup()
  const results = await Promise.allSettled([
    settlePact(deps, 'p1', 'cron'),
    settlePact(deps, 'p1', 'cron'),
  ])
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  assert.equal(paypal.calls.filter((c) => c === 'payout').length, 1)
})

Deno.test('stored plan hash is SHA-256 over canonical settlement JSON', async () => {
  const { deps, saved } = setup()
  await settlePact(deps, 'p1', 'cron')
  const row = saved[0] as { payoutPlan: unknown; hash: string }
  assert.equal(row.hash, await sha256Hex(canonicalJson(row.payoutPlan)))
})
