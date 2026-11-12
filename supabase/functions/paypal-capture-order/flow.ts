/**
 * flow.ts — capture an approved order and fund the pact, or just look (check mode).
 *
 * "check" mode only READS the order. The pact page calls it on load so a stake
 * whose capture succeeded but whose DB write was lost (closed tab, crash) heals
 * itself without a second charge.
 */
import { HttpError } from '../_shared/http.ts'
import type { EventSink } from '../_shared/events.ts'
import { fundPact, validateCapture, type FundingDb, type PayeeExpectation } from '../_shared/funding.ts'
import { refundLateCapture } from '../_shared/lateCapture.ts'
import { PaypalError, type PaypalClient, type PaypalOrder } from '../_shared/paypal.ts'

export interface CapturePact {
  id: string
  user_id: string
  status: string
  stake_cents: number | string
  currency: string
  tz: string
  paypal_order_id: string | null
}

export interface CaptureDeps {
  paypal: PaypalClient
  events: EventSink
  funding: FundingDb
  payee: PayeeExpectation
  now(): Date
  loadPactByOrder(orderId: string): Promise<CapturePact | null>
}

export type CaptureOutcome =
  | { status: 'ACTIVE'; funded: true; alreadyFunded: boolean }
  | { status: 'AWAITING_STAKE'; funded: false; pending: true; paypalStatus: string }

export async function captureFlow(
  deps: CaptureDeps,
  userId: string,
  orderId: string,
  mode: 'capture' | 'check',
): Promise<CaptureOutcome> {
  const pact = await deps.loadPactByOrder(orderId)
  // Someone else's order and an unknown order look identical on purpose.
  if (!pact || pact.user_id !== userId) throw new HttpError(403, 'order_not_yours', 'That order does not belong to this account.')
  if (pact.status === 'ACTIVE') return { status: 'ACTIVE', funded: true, alreadyFunded: true }
  if (pact.status !== 'AWAITING_STAKE') {
    throw new HttpError(409, 'not_awaiting_stake', 'This pact is not waiting for a stake.')
  }

  let order: PaypalOrder
  if (mode === 'check') {
    order = await deps.paypal.getOrder(orderId)
  } else {
    try {
      order = await deps.paypal.captureOrder(orderId)
    } catch (err) {
      if (err instanceof PaypalError && err.issue === 'ORDER_ALREADY_CAPTURED') {
        order = await deps.paypal.getOrder(orderId)
      } else if (err instanceof PaypalError && err.status === 422) {
        throw new HttpError(409, 'order_not_approved', 'The PayPal checkout was not approved, so nothing was charged.')
      } else {
        throw err
      }
    }
  }

  const check = validateCapture(pact, order, deps.payee)
  if (check.kind === 'pending') {
    return { status: 'AWAITING_STAKE', funded: false, pending: true, paypalStatus: check.status }
  }
  if (check.kind === 'mismatch') {
    console.error('capture rejected:', check.reason)
    await deps.events.record({
      source: 'API',
      eventId: `api-rejected-${orderId}`,
      eventType: 'CAPTURE.REJECTED',
      resourceId: orderId,
      pactId: pact.id,
      status: 'REJECTED',
      verified: true,
      detail: { reason: check.reason },
    })
    throw new HttpError(409, 'capture_mismatch', 'The payment did not match this pact, so the pact was not funded.')
  }

  const result = await fundPact(deps.funding, pact, check.capture, deps.now())
  if (!result.funded) {
    const late = await refundLateCapture(deps, {
      pactId: pact.id,
      pactStatus: result.status,
      captureId: check.capture.captureId,
      amountCents: check.capture.amountCents,
    })
    if (late === 'refunded')
      throw new HttpError(409, 'late_payment_refunded', 'The pact expired before the payment finished. It was refunded in full.')
    throw new HttpError(409, 'not_awaiting_stake', 'This pact can no longer be funded.')
  }
  await deps.events.record({
    source: 'API',
    eventId: `api-capture-${check.capture.captureId}`,
    eventType: 'PAYMENT.CAPTURE.COMPLETED',
    resourceId: check.capture.captureId,
    pactId: pact.id,
    status: 'COMPLETED',
    amountCents: check.capture.amountCents,
    verified: true,
    detail: { order_id: orderId },
  })
  return { status: 'ACTIVE', funded: true, alreadyFunded: result.alreadyFunded }
}
