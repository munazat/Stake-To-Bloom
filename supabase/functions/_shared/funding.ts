/**
 * funding.ts — turning a PayPal order into an ACTIVE pact.
 *
 * Shared by paypal-capture-order (the synchronous path) and paypal-webhook (the
 * reconciliation path), so a pact is funded by exactly the same checks whichever
 * arrives first (invariant I3). Either path alone is enough; both together are
 * harmless because every step below is idempotent.
 *
 * Order of writes matters. Everything that can be repeated safely goes first;
 * the AWAITING_STAKE -> ACTIVE compare-and-set goes LAST. If the function dies
 * halfway the pact is still AWAITING_STAKE, so a retry (or the webhook) simply
 * runs the whole sequence again. The only way to be ACTIVE is to have completed
 * every earlier step.
 */
import { PACT_DAYS, localDateKey } from './core/index.ts'
import { centsToPaypalString, type PaypalCapture, type PaypalOrder } from './paypal.ts'

export interface FundablePact {
  id: string
  status: string
  stake_cents: number | string
  currency: string
  tz: string
  paypal_order_id: string | null
}

export interface ValidatedCapture {
  captureId: string
  amountCents: number
  payerEmail: string | null
  payerId: string | null
}

export type CaptureCheck =
  | { kind: 'ok'; capture: ValidatedCapture }
  /** The money is not there yet (order unpaid, capture PENDING). Wait for the webhook. */
  | { kind: 'pending'; status: string }
  /** The money is there but does not match the pact. Never fund. */
  | { kind: 'mismatch'; reason: string }

export interface PayeeExpectation {
  merchantId?: string
  email?: string
}

const PENDING_ORDER_STATES = new Set(['CREATED', 'SAVED', 'APPROVED', 'PAYER_ACTION_REQUIRED'])

function firstCapture(
  order: PaypalOrder,
): { unit: PaypalOrder['purchase_units'][number]; capture: PaypalCapture } | null {
  for (const unit of order.purchase_units) {
    const capture = unit.payments?.captures?.[0]
    if (capture) return { unit, capture }
  }
  return null
}

/**
 * Invariant I3: the seed plants only after a verified COMPLETED capture whose
 * amount, currency, custom_id and payee match. Pure: no I/O, easy to attack in tests.
 */
export function validateCapture(
  pact: Pick<FundablePact, 'id' | 'stake_cents' | 'currency' | 'paypal_order_id'>,
  order: PaypalOrder,
  payee: PayeeExpectation = {},
): CaptureCheck {
  if (pact.paypal_order_id !== order.id) {
    return { kind: 'mismatch', reason: 'order id does not belong to this pact' }
  }
  const found = firstCapture(order)
  if (!found) {
    return PENDING_ORDER_STATES.has(order.status)
      ? { kind: 'pending', status: order.status }
      : { kind: 'mismatch', reason: `order is ${order.status} with no capture` }
  }
  const { unit, capture } = found
  if (capture.status !== 'COMPLETED') {
    // PENDING and friends are not money yet; DECLINED/FAILED will never become money.
    return capture.status === 'PENDING'
      ? { kind: 'pending', status: capture.status }
      : { kind: 'mismatch', reason: `capture is ${capture.status}` }
  }
  if (order.status !== 'COMPLETED') return { kind: 'mismatch', reason: `order is ${order.status}` }

  const customId = capture.custom_id ?? unit.custom_id
  if (customId !== pact.id) return { kind: 'mismatch', reason: 'custom_id does not match the pact' }

  const amount = capture.amount ?? unit.amount
  if (!amount) return { kind: 'mismatch', reason: 'capture has no amount' }
  if (amount.currency_code !== pact.currency || pact.currency !== 'USD') {
    return { kind: 'mismatch', reason: 'currency mismatch' }
  }
  const expected = centsToPaypalString(Number(pact.stake_cents))
  if (amount.value !== expected) return { kind: 'mismatch', reason: 'amount mismatch' }

  if (payee.merchantId && unit.payee?.merchant_id !== payee.merchantId) {
    return { kind: 'mismatch', reason: 'payee merchant mismatch' }
  }
  if (payee.email && unit.payee?.email_address?.toLowerCase() !== payee.email.toLowerCase()) {
    return { kind: 'mismatch', reason: 'payee email mismatch' }
  }

  return {
    kind: 'ok',
    capture: {
      captureId: capture.id,
      amountCents: Number(pact.stake_cents),
      payerEmail: order.payer?.email_address ?? null,
      payerId: order.payer?.payer_id ?? null,
    },
  }
}

/** The 7 local calendar dates of a pact, starting on the local day of `startsAt`. */
export function dayDates(startsAt: Date, tz: string): string[] {
  const [y, m, d] = localDateKey(startsAt, tz).split('-').map(Number)
  return Array.from({ length: PACT_DAYS }, (_, i) =>
    new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10),
  )
}

export interface FundingDb {
  saveCapture(
    pactId: string,
    fields: {
      paypal_capture_id: string
      payer_email: string | null
      payer_id: string | null
      starts_at: string
      ends_at: string
      funded_at: string
      vitality: number
    },
  ): Promise<
    { kind: 'saved' } | { kind: 'already_active' } | { kind: 'wrong_status'; status: string }
  >
  addLedger(pactId: string, captureId: string, cents: number): Promise<void>
  addDays(
    pactId: string,
    days: Array<{ pact_id: string; day_index: number; date_local: string }>,
  ): Promise<void>
  /** AWAITING_STAKE -> ACTIVE. 'raced' means someone else got there first. */
  activate(pactId: string): Promise<'moved' | 'raced'>
}

export type FundResult =
  | { funded: true; alreadyFunded: boolean }
  | { funded: false; reason: 'wrong_status'; status: string }

export const SEED_VITALITY = 0.15

export async function fundPact(
  db: FundingDb,
  pact: Pick<FundablePact, 'id' | 'status' | 'tz'>,
  capture: ValidatedCapture,
  now: Date,
): Promise<FundResult> {
  if (pact.status === 'ACTIVE') return { funded: true, alreadyFunded: true }
  if (pact.status !== 'AWAITING_STAKE')
    return { funded: false, reason: 'wrong_status', status: pact.status }

  const dates = dayDates(now, pact.tz)
  const saved = await db.saveCapture(pact.id, {
    paypal_capture_id: capture.captureId,
    payer_email: capture.payerEmail,
    payer_id: capture.payerId,
    starts_at: now.toISOString(),
    ends_at: new Date(now.getTime() + PACT_DAYS * 86_400_000).toISOString(),
    funded_at: now.toISOString(),
    vitality: SEED_VITALITY,
  })
  if (saved.kind === 'already_active') return { funded: true, alreadyFunded: true }
  if (saved.kind === 'wrong_status') {
    return { funded: false, reason: 'wrong_status', status: saved.status }
  }
  await db.addLedger(pact.id, capture.captureId, capture.amountCents)
  await db.addDays(
    pact.id,
    dates.map((date_local, day_index) => ({ pact_id: pact.id, day_index, date_local })),
  )
  const moved = await db.activate(pact.id)
  return { funded: true, alreadyFunded: moved === 'raced' }
}

/** The service-role implementation of FundingDb. */
// deno-lint-ignore no-explicit-any
export function supabaseFundingDb(admin: any): FundingDb {
  const fail = (what: string, error: { code?: string } | null): never => {
    console.error(`funding: ${what} failed:`, error?.code ?? error)
    throw new Error(`${what} failed`)
  }
  return {
    async saveCapture(pactId, fields) {
      const { data, error } = await admin
        .from('pacts')
        .update(fields)
        .eq('id', pactId)
        .eq('status', 'AWAITING_STAKE')
        .select('id')
        .maybeSingle()
      if (error) fail('save capture', error)
      if (data) return { kind: 'saved' }

      // A concurrent capture may have completed funding after our caller loaded
      // the pact. Treat only that exact capture as idempotent; an EXPIRED or
      // otherwise moved pact must not acquire ledger/day rows from this call.
      const { data: current, error: readError } = await admin
        .from('pacts')
        .select('status,paypal_capture_id')
        .eq('id', pactId)
        .maybeSingle()
      if (readError) fail('verify funding state', readError)
      if (current?.status === 'ACTIVE' && current.paypal_capture_id === fields.paypal_capture_id) {
        return { kind: 'already_active' }
      }
      return { kind: 'wrong_status', status: current?.status ?? 'NOT_FOUND' }
    },
    async addLedger(pactId, captureId, cents) {
      const { error } = await admin
        .from('ledger_entries')
        .insert({ pact_id: pactId, kind: 'STAKE_IN', amount_cents: cents, ref: captureId })
      // 23505 = this capture is already on the ledger: that is the idempotency guarantee.
      if (error && error.code !== '23505') fail('write ledger', error)
    },
    async addDays(_pactId, days) {
      const { error } = await admin
        .from('pact_days')
        .upsert(days, { onConflict: 'pact_id,day_index', ignoreDuplicates: true })
      if (error) fail('create days', error)
    },
    async activate(pactId) {
      const { error } = await admin.rpc('transition_pact', {
        p_pact_id: pactId,
        p_from: 'AWAITING_STAKE',
        p_to: 'ACTIVE',
      })
      if (error?.code === '40001') return 'raced'
      if (error) fail('activate pact', error)
      return 'moved'
    },
  }
}
