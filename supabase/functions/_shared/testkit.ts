/** Fakes shared by the payment tests. Never imported by a deployed function. */
import type { AuditEvent, EventSink } from './events.ts'
import type { FundingDb } from './funding.ts'
import type { PaypalClient, PaypalOrder } from './paypal.ts'

export const USER = '0a0a0a0a-0000-4000-8000-000000000001'
export const OTHER = '0b0b0b0b-0000-4000-8000-000000000002'
export const PACT = '0c0c0c0c-0000-4000-8000-000000000003'
export const ORDER = 'ORDER-123'
export const CAPTURE = 'CAPTURE-456'

export function completedOrder(
  overrides: {
    amount?: string
    currency?: string
    customId?: string
    captureStatus?: string
    orderStatus?: string
    orderId?: string
  } = {},
): PaypalOrder {
  const amount = { currency_code: overrides.currency ?? 'USD', value: overrides.amount ?? '20.00' }
  return {
    id: overrides.orderId ?? ORDER,
    status: overrides.orderStatus ?? 'COMPLETED',
    payer: { email_address: 'buyer@example.com', payer_id: 'PAYER1' },
    purchase_units: [
      {
        reference_id: PACT,
        custom_id: overrides.customId ?? PACT,
        amount,
        payee: { merchant_id: 'MERCHANT1', email_address: 'shop@example.com' },
        payments: {
          captures: [
            {
              id: CAPTURE,
              status: overrides.captureStatus ?? 'COMPLETED',
              amount,
              custom_id: overrides.customId ?? PACT,
            },
          ],
        },
      },
    ],
  }
}

export const unpaidOrder = (): PaypalOrder => ({
  id: ORDER,
  status: 'APPROVED',
  purchase_units: [{ custom_id: PACT, amount: { currency_code: 'USD', value: '20.00' } }],
})

export const pactRow = (over: Record<string, unknown> = {}) => ({
  id: PACT,
  user_id: USER,
  status: 'AWAITING_STAKE',
  stake_cents: 2000,
  currency: 'USD',
  tz: 'Asia/Karachi',
  paypal_order_id: ORDER as string | null,
  ...over,
})

export interface FakeFunding extends FundingDb {
  calls: string[]
  days: Array<{ day_index: number; date_local: string }>
  ledger: Array<{ ref: string; cents: number }>
  saved: Record<string, unknown>[]
  /** Result `activate` returns. */
  activateResult: 'moved' | 'raced'
}

export function fakeFunding(): FakeFunding {
  const f: FakeFunding = {
    calls: [],
    days: [],
    ledger: [],
    saved: [],
    activateResult: 'moved',
    saveCapture(_id, fields) {
      f.calls.push('saveCapture')
      f.saved.push(fields)
      return Promise.resolve()
    },
    addLedger(_id, ref, cents) {
      f.calls.push('addLedger')
      if (!f.ledger.some((l) => l.ref === ref)) f.ledger.push({ ref, cents })
      return Promise.resolve()
    },
    addDays(_id, days) {
      f.calls.push('addDays')
      f.days = days
      return Promise.resolve()
    },
    activate() {
      f.calls.push('activate')
      return Promise.resolve(f.activateResult)
    },
  }
  return f
}

export interface FakeEvents extends EventSink {
  rows: AuditEvent[]
}

export function fakeEvents(): FakeEvents {
  const e: FakeEvents = {
    rows: [],
    record(row) {
      if (row.eventId && e.rows.some((r) => r.eventId === row.eventId)) return Promise.resolve('duplicate')
      e.rows.push(row)
      return Promise.resolve('recorded')
    },
    seen: (id) => Promise.resolve(e.rows.some((r) => r.eventId === id)),
  }
  return e
}

export interface FakePaypal extends PaypalClient {
  calls: string[]
  orderToReturn: PaypalOrder
  captureError: Error | null
  verifyResult: boolean | Error
}

export function fakePaypal(order: PaypalOrder = completedOrder()): FakePaypal {
  const p: FakePaypal = {
    kind: 'sandbox',
    calls: [],
    orderToReturn: order,
    captureError: null,
    verifyResult: true,
    createOrder(input) {
      p.calls.push(`create:${input.attempt}`)
      return Promise.resolve({ id: `NEW-ORDER-${input.attempt}`, status: 'CREATED' })
    },
    getOrder() {
      p.calls.push('get')
      return Promise.resolve(p.orderToReturn)
    },
    captureOrder() {
      p.calls.push('capture')
      return p.captureError ? Promise.reject(p.captureError) : Promise.resolve(p.orderToReturn)
    },
    verifyWebhook() {
      p.calls.push('verify')
      return p.verifyResult instanceof Error ? Promise.reject(p.verifyResult) : Promise.resolve(p.verifyResult)
    },
  }
  return p
}
