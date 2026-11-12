/** flow_test.ts — capture ownership, idempotency, check mode. No network. */
import assert from 'node:assert/strict'
import { HttpError } from '../_shared/http.ts'
import { PaypalError } from '../_shared/paypal.ts'
import {
  CAPTURE,
  OTHER,
  ORDER,
  USER,
  completedOrder,
  fakeEvents,
  fakeFunding,
  fakePaypal,
  pactRow,
  unpaidOrder,
} from '../_shared/testkit.ts'
import { captureFlow, type CaptureDeps } from './flow.ts'

function setup(pact: ReturnType<typeof pactRow> | null = pactRow()) {
  const paypal = fakePaypal()
  const events = fakeEvents()
  const funding = fakeFunding()
  const deps: CaptureDeps = {
    paypal,
    events,
    funding,
    payee: {},
    now: () => new Date('2026-11-11T10:00:00Z'),
    loadPactByOrder: (id) => Promise.resolve(pact && pact.paypal_order_id === id ? pact : null),
  }
  return { paypal, events, funding, deps }
}

const status = (e: unknown) => (e instanceof HttpError ? e.status : -1)

Deno.test('capture: funds the pact, writes the ledger once, records an audit row', async () => {
  const { paypal, events, funding, deps } = setup()
  const out = await captureFlow(deps, USER, ORDER, 'capture')
  assert.deepEqual(out, { status: 'ACTIVE', funded: true, alreadyFunded: false })
  assert.deepEqual(paypal.calls, ['capture', 'get'])
  assert.deepEqual(funding.calls, ['saveCapture', 'addLedger', 'addDays', 'activate'])
  assert.equal(events.rows[0].eventType, 'PAYMENT.CAPTURE.COMPLETED')
  assert.equal(events.rows[0].resourceId, CAPTURE)
  assert.equal(JSON.stringify(events.rows).includes('buyer@example.com'), false) // no email in audit rows
})

Deno.test('someone else\'s order id, or an unknown one, is 403 and touches nothing', async () => {
  const { paypal, funding, deps } = setup()
  await assert.rejects(captureFlow(deps, OTHER, ORDER, 'capture'), (e) => status(e) === 403)
  await assert.rejects(captureFlow(deps, USER, 'NOT-A-REAL-ORDER', 'capture'), (e) => status(e) === 403)
  assert.deepEqual(paypal.calls, [])
  assert.deepEqual(funding.calls, [])
})

Deno.test('double click: an already ACTIVE pact is a no-op and never calls PayPal', async () => {
  const { paypal, funding, deps } = setup(pactRow({ status: 'ACTIVE' }))
  const out = await captureFlow(deps, USER, ORDER, 'capture')
  assert.deepEqual(out, { status: 'ACTIVE', funded: true, alreadyFunded: true })
  assert.deepEqual(paypal.calls, [])
  assert.deepEqual(funding.calls, [])
})

Deno.test('ORDER_ALREADY_CAPTURED is read back and treated as success if it validates', async () => {
  const { paypal, funding, deps } = setup()
  paypal.captureError = new PaypalError(422, 'ORDER_ALREADY_CAPTURED', 'd', 'already')
  const out = await captureFlow(deps, USER, ORDER, 'capture')
  assert.equal(out.status, 'ACTIVE')
  assert.deepEqual(paypal.calls, ['capture', 'get'])
  assert.equal(funding.ledger.length, 1)
})

Deno.test('an order the buyer never approved is a 409 and nothing is funded', async () => {
  const { paypal, funding, deps } = setup()
  paypal.captureError = new PaypalError(422, 'ORDER_NOT_APPROVED', 'd', 'not approved')
  await assert.rejects(captureFlow(deps, USER, ORDER, 'capture'), (e) => status(e) === 409)
  assert.deepEqual(funding.calls, [])
})

Deno.test('a PENDING capture leaves the pact AWAITING_STAKE for the webhook', async () => {
  const { paypal, funding, deps } = setup()
  paypal.orderToReturn = completedOrder({ captureStatus: 'PENDING' })
  const out = await captureFlow(deps, USER, ORDER, 'capture')
  assert.deepEqual(out, { status: 'AWAITING_STAKE', funded: false, pending: true, paypalStatus: 'PENDING' })
  assert.deepEqual(funding.calls, [])
})

Deno.test('I3: a captured amount that differs from the pact is refused and audited', async () => {
  const { paypal, events, funding, deps } = setup()
  paypal.orderToReturn = completedOrder({ amount: '1.00' })
  await assert.rejects(captureFlow(deps, USER, ORDER, 'capture'), (e) => status(e) === 409)
  assert.deepEqual(funding.calls, [])
  assert.equal(events.rows[0].eventType, 'CAPTURE.REJECTED')
})

Deno.test('check mode only reads: it never captures, and funds only an already-paid order', async () => {
  const unpaid = setup()
  unpaid.paypal.orderToReturn = unpaidOrder()
  const a = await captureFlow(unpaid.deps, USER, ORDER, 'check')
  assert.equal(a.status, 'AWAITING_STAKE')
  assert.deepEqual(unpaid.paypal.calls, ['get'])
  assert.deepEqual(unpaid.funding.calls, [])

  const paid = setup() // capture succeeded at PayPal but our DB write was lost: heal it
  const b = await captureFlow(paid.deps, USER, ORDER, 'check')
  assert.deepEqual(b, { status: 'ACTIVE', funded: true, alreadyFunded: false })
  assert.deepEqual(paid.paypal.calls, ['get'])
})

Deno.test('a capture that lands after the pact expired is refunded once and audited', async () => {
  const { paypal, events, funding, deps } = setup()
  funding.saveCaptureResult = { kind: 'wrong_status', status: 'EXPIRED' }
  await assert.rejects(
    captureFlow(deps, USER, ORDER, 'capture'),
    (e) => status(e) === 409 && (e as HttpError).code === 'late_payment_refunded',
  )
  assert.deepEqual(paypal.calls, ['capture', 'get', 'refund'])
  assert.equal(events.rows.at(-1)?.eventType, 'LATE_CAPTURE.REFUNDED')
  assert.equal(funding.ledger.length, 0) // never reached the ledger
})

Deno.test('a late capture on a pact in any other state is NOT refunded automatically', async () => {
  const { paypal, funding, deps } = setup()
  funding.saveCaptureResult = { kind: 'wrong_status', status: 'SETTLED_PASS' }
  await assert.rejects(captureFlow(deps, USER, ORDER, 'capture'), (e) => status(e) === 409)
  assert.deepEqual(paypal.calls, ['capture', 'get'])
})
