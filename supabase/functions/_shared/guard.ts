/** Deterministic preflight checks for a stored settlement plan. */
import { sha256Hex, canonicalJson } from './core/index.ts'
import { HttpError } from './http.ts'

export interface PayoutGuardInput {
  plan: {
    items: Array<{ pactId: string; amountCents: number; recipientEmail: string | null }>
    charityCents: number
    charityEmail: string | null
  }
  expectedPlanHash: string
  storedPlanHash: string
  status: string
  hasEarlierPayout: boolean
  expectedRecipients: Record<string, string | null>
  charityEmail: string | null
  ledgerStakeCents: number
  simulatedForfeitCents: number
  isDemo: boolean
  ruleHashesMatch: boolean
  closedDayCount: number
  requiredDayCount: number
  settlementEnabled: boolean
  paymentsEnabled: boolean
  sandbox: boolean
  caller: 'cron' | 'owner' | 'admin' | 'user'
  demoOwner: boolean
}

export async function assertPayoutSafe(input: PayoutGuardInput): Promise<void> {
  const reject = (code: string, message: string): never => {
    throw new HttpError(409, code, message)
  }
  if (!input.sandbox) reject('sandbox_required', 'Payouts are available in sandbox only.')
  if (!input.settlementEnabled || !input.paymentsEnabled)
    throw new HttpError(503, 'settlement_disabled', 'Settlement is switched off.')
  if (input.status !== 'SETTLING' || input.hasEarlierPayout)
    reject('settlement_state', 'This pact is not eligible for a new payout.')
  for (const item of input.plan.items) {
    if (!item.recipientEmail || item.recipientEmail !== input.expectedRecipients[item.pactId])
      reject('recipient_mismatch', 'A payout recipient does not match its captured payer.')
  }
  if (
    input.plan.charityCents > 0 &&
    (!input.plan.charityEmail || input.plan.charityEmail !== input.charityEmail)
  )
    reject('charity_mismatch', 'The charity recipient is not configured for this sandbox.')
  const amounts = [
    ...input.plan.items.map((i) => i.amountCents),
    ...(input.plan.charityCents > 0 ? [input.plan.charityCents] : []),
  ]
  if (
    amounts.some((n) => !Number.isSafeInteger(n) || n < 1 || n > 20_000) ||
    amounts.reduce((a, b) => a + b, 0) >= 50_000
  )
    reject('payout_cap', 'The payout exceeds the permitted amount.')
  if (
    input.plan.items.reduce((n, i) => n + i.amountCents, input.plan.charityCents) >
    input.ledgerStakeCents + (input.isDemo ? input.simulatedForfeitCents : 0)
  )
    reject('ledger_cap', 'The payout exceeds funds recorded in the ledger.')
  if (input.expectedPlanHash !== input.storedPlanHash)
    reject('plan_hash_mismatch', 'The stored settlement plan has changed.')
  if (!input.ruleHashesMatch)
    reject('rule_hash_mismatch', 'A pact rule no longer matches its funded rule.')
  if (input.closedDayCount < input.requiredDayCount && !input.isDemo)
    reject('days_open', 'Pacts cannot settle until all required days are closed.')
  if (!(
    input.caller === 'cron' ||
    input.caller === 'admin' ||
    (input.caller === 'owner' && input.demoOwner)
  ))
    throw new HttpError(403, 'settlement_forbidden', 'This caller cannot run settlements.')
  const computedHash = await sha256Hex(canonicalJson(input.plan))
  if (computedHash !== input.expectedPlanHash)
    reject('plan_hash_invalid', 'The settlement plan hash is invalid.')
}
