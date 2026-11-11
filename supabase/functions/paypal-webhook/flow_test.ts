/** flow_test.ts — webhook: signature, replay, size cap, funding, review. No network. */
import assert from 'node:assert/strict'
import { HttpError } from '../_shared/http.ts'
import { CAPTURE, ORDER, PACT, completedOrder, fakeEvents, fakeFunding, fakePaypal, pactRow } from '../_shared/testkit.ts'
import { MAX_WEBHOOK_BYTES, handleWebhook, type WebhookDeps } from './flow.ts'

function setup(pact: ReturnType<typeof pactRow> | null = pactRow()) {
  const paypal = fakePaypal()
  const events = fakeEvents()
  const funding = fakeFunding()
  const flagged: string[] = []
  const deps: WebhookDeps = {
    paypal,
    events,
    funding,
    payee: {},
    webhookId: 'WH1',
    now: () => new Date('2026-11-11T10:00:00Z'),
    loadPactByOrder: (id) => Promise.resolve(pact && pact.paypal_order_id === id ? pact : null),
    loadPactByCapture: (id) => Promise.resolve(pact && id === CAPTURE ? pact : null),
    flagForReview: (id) => {
      flagged.push(id)
      return Promise.resolve('moved')
    },
  }
  return { paypal, events, funding, flagged, deps }
}

function eventBody(type = 'PAYMENT.CAPTURE.COMPLETED', id = 'WH-EVT-1') {
  return {
    id,
    event_type: type,
    resource: {
      id: CAPTURE,
      status: 'COMPLETED',
      amount: { currency_code: 'USD', value: '20.00' },
      supplementary_data: { related_ids: { order_id: ORDER } },
    },
  }
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://x.test/paypal-webhook', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

async function status(p: Promise<Response>): Promise<number> {
  try {
    return (await p).status
  } catch (e) {
    return e instanceof HttpError ? e.status : -1
  }
}

Deno.test('a verified CAPTURE.COMPLETED funds the pact and is audited as verified', async () => {
  const { paypal, events, funding, deps } = setup()
  const res = await handleWebhook(deps, post(eventBody()))
  assert.equal(res.status, 200)
  assert.deepEqual(paypal.calls, ['verify', 'get'])
  assert.deepEqual(funding.calls, ['saveCapture', 'addLedger', 'addDays', 'activate'])
  assert.equal(events.rows.length, 1)
  assert.equal(events.rows[0].source, 'WEBHOOK')
  assert.equal(events.rows[0].verified, true)
  assert.equal(events.rows[0].amountCents, 2000)
  assert.equal(events.rows[0].pactId, PACT)
})

Deno.test('a tampered or unsigned body is 400 and does nothing at all', async () => {
  const { paypal, events, funding, deps } = setup()
  paypal.verifyResult = false
  assert.equal(await status(handleWebhook(deps, post(eventBody()))), 400)
  assert.deepEqual(paypal.calls, ['verify']) // never even looked the order up
  assert.deepEqual(funding.calls, [])
  assert.equal(events.rows.length, 0)
})

Deno.test('a replayed event is 200 and changes nothing', async () => {
  const { funding, events, deps } = setup()
  await handleWebhook(deps, post(eventBody()))
  const callsAfterFirst = [...funding.calls]
  const res = await handleWebhook(deps, post(eventBody()))
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: true, replay: true })
  assert.deepEqual(funding.calls, callsAfterFirst)
  assert.equal(events.rows.length, 1)
  assert.equal(funding.ledger.length, 1)
})

Deno.test('if processing fails the event id is NOT marked seen, so the retry runs again', async () => {
  const { funding, events, deps } = setup()
  funding.addLedger = () => Promise.reject(new Error('db down'))
  await assert.rejects(handleWebhook(deps, post(eventBody())))
  assert.equal(events.rows.length, 0)
  funding.addLedger = () => Promise.resolve()
  assert.equal((await handleWebhook(deps, post(eventBody()))).status, 200)
  assert.equal(events.rows.length, 1)
})

Deno.test('a body over 100 KB is 413 before any verification call', async () => {
  const { paypal, deps } = setup()
  const big = JSON.stringify({ id: 'x', event_type: 'A', pad: 'z'.repeat(MAX_WEBHOOK_BYTES + 10) })
  assert.equal(await status(handleWebhook(deps, post(big))), 413)
  assert.deepEqual(paypal.calls, [])
})

Deno.test('malformed JSON and non-object bodies are 400', async () => {
  const { deps } = setup()
  assert.equal(await status(handleWebhook(deps, post('not json'))), 400)
  assert.equal(await status(handleWebhook(deps, post('[1,2]'))), 400)
  assert.equal(await status(handleWebhook(deps, post({ no: 'id' }))), 400)
})

Deno.test('a verification outage is 503 (PayPal retries), not a rejection', async () => {
  const { paypal, deps } = setup()
  paypal.verifyResult = new Error('timeout')
  assert.equal(await status(handleWebhook(deps, post(eventBody()))), 503)
})

Deno.test('a capture for an amount that does not match is recorded as REJECTED and funds nothing', async () => {
  const { paypal, events, funding, deps } = setup()
  paypal.orderToReturn = completedOrder({ amount: '1.00' })
  assert.equal((await handleWebhook(deps, post(eventBody()))).status, 200)
  assert.deepEqual(funding.calls, [])
  assert.equal(events.rows[0].status, 'REJECTED')
})

Deno.test('an event for an order we do not know is recorded and changes nothing', async () => {
  const { funding, events, deps } = setup(null)
  assert.equal((await handleWebhook(deps, post(eventBody()))).status, 200)
  assert.deepEqual(funding.calls, [])
  assert.equal(events.rows[0].pactId, null)
})

Deno.test('CAPTURE.REVERSED flags the pact for review; payout events only appear on the feed', async () => {
  const { flagged, funding, events, deps } = setup(pactRow({ status: 'ACTIVE' }))
  await handleWebhook(deps, post(eventBody('PAYMENT.CAPTURE.REVERSED', 'E2')))
  assert.deepEqual(flagged, [PACT])
  await handleWebhook(deps, post(eventBody('PAYMENT.PAYOUTSBATCH.SUCCESS', 'E3')))
  assert.deepEqual(flagged, [PACT]) // unchanged
  assert.deepEqual(funding.calls, [])
  assert.equal(events.rows.length, 2)
})
