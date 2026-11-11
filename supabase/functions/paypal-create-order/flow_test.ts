/** flow_test.ts — order creation takes its amount from the row and resumes open orders. */
import assert from 'node:assert/strict'
import { HttpError } from '../_shared/http.ts'
import { PaypalError } from '../_shared/paypal.ts'
import { OTHER, ORDER, PACT, USER, fakeEvents, fakePaypal, pactRow, unpaidOrder } from '../_shared/testkit.ts'
import { createOrderFlow, type CreateOrderDeps } from './flow.ts'

function setup(pact: ReturnType<typeof pactRow> | null, priorOrders = 0) {
  const paypal = fakePaypal(unpaidOrder())
  const events = fakeEvents()
  const saved: string[] = []
  const deps: CreateOrderDeps = {
    paypal,
    events,
    returnUrl: 'http://localhost:5173',
    loadPact: () => Promise.resolve(pact),
    countOrders: () => Promise.resolve(priorOrders),
    saveOrderId: (_id, orderId) => {
      saved.push(orderId)
      return Promise.resolve()
    },
  }
  return { paypal, events, saved, deps }
}

const status = (e: unknown) => (e instanceof HttpError ? e.status : -1)

Deno.test('creates an order, saves its id on the pact and audits it', async () => {
  const { paypal, events, saved, deps } = setup(pactRow({ paypal_order_id: null }))
  const out = await createOrderFlow(deps, USER, PACT)
  assert.deepEqual(out, { orderId: 'NEW-ORDER-1', resumed: false })
  assert.deepEqual(paypal.calls, ['create:1'])
  assert.deepEqual(saved, ['NEW-ORDER-1'])
  assert.equal(events.rows[0].eventType, 'CHECKOUT.ORDER.CREATED')
  assert.equal(events.rows[0].amountCents, 2000)
})

Deno.test('a pact that is not the caller\'s is a 404; one not awaiting a stake is a 409', async () => {
  await assert.rejects(createOrderFlow(setup(pactRow()).deps, OTHER, PACT), (e) => status(e) === 404)
  await assert.rejects(createOrderFlow(setup(null).deps, USER, PACT), (e) => status(e) === 404)
  await assert.rejects(createOrderFlow(setup(pactRow({ status: 'ACTIVE' })).deps, USER, PACT), (e) => status(e) === 409)
  await assert.rejects(createOrderFlow(setup(pactRow({ status: 'DRAFT' })).deps, USER, PACT), (e) => status(e) === 409)
})

Deno.test('a closed popup resumes the SAME open order instead of creating a second one', async () => {
  const { paypal, saved, deps } = setup(pactRow())
  const out = await createOrderFlow(deps, USER, PACT)
  assert.deepEqual(out, { orderId: ORDER, resumed: true })
  assert.deepEqual(paypal.calls, ['get'])
  assert.deepEqual(saved, [])
})

Deno.test('an order PayPal no longer knows is replaced with the next attempt number', async () => {
  const { paypal, deps } = setup(pactRow(), 1)
  paypal.getOrder = () => Promise.reject(new PaypalError(404, 'INVALID_RESOURCE_ID', null, 'gone'))
  const out = await createOrderFlow(deps, USER, PACT)
  assert.deepEqual(out, { orderId: 'NEW-ORDER-2', resumed: false })
})

Deno.test('a voided order is replaced too', async () => {
  const { paypal, deps } = setup(pactRow(), 1)
  paypal.orderToReturn = { ...unpaidOrder(), status: 'VOIDED' }
  const out = await createOrderFlow(deps, USER, PACT)
  assert.equal(out.resumed, false)
})
