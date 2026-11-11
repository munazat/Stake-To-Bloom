/**
 * flow.ts — create (or resume) the PayPal order for a pact's stake.
 *
 * The amount, currency and pact come from the DATABASE ROW (invariant I2). The
 * only thing the client sends is a pact id, and it is checked against the
 * caller's identity before anything is created.
 */
import { HttpError } from '../_shared/http.ts'
import type { EventSink } from '../_shared/events.ts'
import { PaypalError, type PaypalClient } from '../_shared/paypal.ts'

export interface OrderPact {
  id: string
  user_id: string
  status: string
  stake_cents: number | string
  currency: string
  paypal_order_id: string | null
}

export interface CreateOrderDeps {
  paypal: PaypalClient
  events: EventSink
  loadPact(pactId: string): Promise<OrderPact | null>
  /** How many orders we have created for this pact so far (audit rows). */
  countOrders(pactId: string): Promise<number>
  saveOrderId(pactId: string, orderId: string): Promise<void>
  returnUrl: string
}

const REUSABLE = new Set(['CREATED', 'SAVED', 'APPROVED', 'PAYER_ACTION_REQUIRED'])

export async function createOrderFlow(
  deps: CreateOrderDeps,
  userId: string,
  pactId: string,
): Promise<{ orderId: string; resumed: boolean }> {
  const pact = await deps.loadPact(pactId)
  if (!pact || pact.user_id !== userId) throw new HttpError(404, 'pact_not_found', 'No such pact for this account.')
  if (pact.status !== 'AWAITING_STAKE') {
    throw new HttpError(409, 'not_awaiting_stake', 'This pact is not waiting for a stake.')
  }
  if (pact.currency !== 'USD') throw new HttpError(409, 'bad_currency', 'Only USD is supported.')

  // A user who closed the popup should get the SAME order back, not a second one.
  if (pact.paypal_order_id) {
    try {
      const existing = await deps.paypal.getOrder(pact.paypal_order_id)
      if (REUSABLE.has(existing.status) || existing.status === 'COMPLETED') {
        return { orderId: existing.id, resumed: true }
      }
    } catch (err) {
      // An order PayPal no longer knows (expired/voided) is replaced below.
      if (!(err instanceof PaypalError) || err.status !== 404) throw err
    }
  }

  const attempt = (await deps.countOrders(pactId)) + 1
  const created = await deps.paypal.createOrder({
    pactId: pact.id,
    stakeCents: Number(pact.stake_cents),
    attempt,
    returnUrl: deps.returnUrl,
  })
  await deps.saveOrderId(pact.id, created.id)
  await deps.events.record({
    source: 'API',
    eventType: 'CHECKOUT.ORDER.CREATED',
    resourceId: created.id,
    pactId: pact.id,
    status: created.status,
    amountCents: Number(pact.stake_cents),
    verified: true,
    detail: { attempt },
  })
  return { orderId: created.id, resumed: false }
}
