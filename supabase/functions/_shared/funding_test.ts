/** funding_test.ts — invariant I3 and the write order of fundPact. */
import assert from 'node:assert/strict'
import { dayDates, fundPact, validateCapture } from './funding.ts'
import { CAPTURE, completedOrder, fakeFunding, pactRow, unpaidOrder } from './testkit.ts'

const pact = pactRow()

Deno.test('I3: a matching COMPLETED capture validates and yields the payer from the response', () => {
  const r = validateCapture(pact, completedOrder())
  assert.equal(r.kind, 'ok')
  if (r.kind === 'ok') {
    assert.deepEqual(r.capture, {
      captureId: CAPTURE,
      amountCents: 2000,
      payerEmail: 'buyer@example.com',
      payerId: 'PAYER1',
    })
  }
})

Deno.test('I3: every mismatch is refused', () => {
  const cases: Array<[string, ReturnType<typeof completedOrder>]> = [
    ['wrong amount', completedOrder({ amount: '19.99' })],
    ['amount with a different format', completedOrder({ amount: '20' })],
    ['wrong currency', completedOrder({ currency: 'EUR' })],
    ['wrong custom_id', completedOrder({ customId: '99999999-0000-4000-8000-000000000009' })],
    ['capture declined', completedOrder({ captureStatus: 'DECLINED' })],
    ['order not completed', completedOrder({ orderStatus: 'APPROVED' })],
    ['another order id', completedOrder({ orderId: 'SOMEONE-ELSES-ORDER' })],
  ]
  for (const [label, order] of cases) assert.equal(validateCapture(pact, order).kind, 'mismatch', label)
})

Deno.test('a PENDING capture or an unpaid order is "pending", never funded', () => {
  assert.equal(validateCapture(pact, completedOrder({ captureStatus: 'PENDING' })).kind, 'pending')
  assert.equal(validateCapture(pact, unpaidOrder()).kind, 'pending')
})

Deno.test('payee is checked only when configured, and must match when it is', () => {
  assert.equal(validateCapture(pact, completedOrder(), { merchantId: 'MERCHANT1' }).kind, 'ok')
  assert.equal(validateCapture(pact, completedOrder(), { merchantId: 'OTHER' }).kind, 'mismatch')
  assert.equal(validateCapture(pact, completedOrder(), { email: 'SHOP@example.com' }).kind, 'ok')
  assert.equal(validateCapture(pact, completedOrder(), { email: 'thief@example.com' }).kind, 'mismatch')
})

Deno.test('dayDates: 7 consecutive local dates in the pact zone', () => {
  // 2026-11-10 22:00 UTC is already 2026-11-11 in Karachi (UTC+5).
  const dates = dayDates(new Date('2026-11-10T22:00:00Z'), 'Asia/Karachi')
  assert.equal(dates.length, 7)
  assert.equal(dates[0], '2026-11-11')
  assert.equal(dates[6], '2026-11-17')
  assert.equal(dayDates(new Date('2026-12-28T12:00:00Z'), 'UTC')[6], '2027-01-03') // year boundary
})

Deno.test('fundPact: repeatable steps first, the ACTIVE compare-and-set LAST', async () => {
  const db = fakeFunding()
  const now = new Date('2026-11-10T22:00:00Z')
  const r = await fundPact(
    db,
    pact,
    { captureId: CAPTURE, amountCents: 2000, payerEmail: 'b@example.com', payerId: 'P' },
    now,
  )
  assert.deepEqual(r, { funded: true, alreadyFunded: false })
  assert.deepEqual(db.calls, ['saveCapture', 'addLedger', 'addDays', 'activate'])
  assert.equal(db.days.length, 7)
  assert.deepEqual(db.ledger, [{ ref: CAPTURE, cents: 2000 }])
  assert.equal(db.saved[0].vitality, 0.15)
  assert.equal(db.saved[0].funded_at, now.toISOString())
})

Deno.test('fundPact: running it twice does not double the ledger (I4)', async () => {
  const db = fakeFunding()
  const cap = { captureId: CAPTURE, amountCents: 2000, payerEmail: null, payerId: null }
  await fundPact(db, pact, cap, new Date())
  db.activateResult = 'raced'
  const second = await fundPact(db, pact, cap, new Date())
  assert.deepEqual(second, { funded: true, alreadyFunded: true })
  assert.equal(db.ledger.length, 1)
})

Deno.test('fundPact: an ACTIVE pact is a no-op; an EXPIRED pact is not funded', async () => {
  const db = fakeFunding()
  const cap = { captureId: CAPTURE, amountCents: 2000, payerEmail: null, payerId: null }
  assert.deepEqual(await fundPact(db, { ...pact, status: 'ACTIVE' }, cap, new Date()), {
    funded: true,
    alreadyFunded: true,
  })
  assert.deepEqual(db.calls, [])
  assert.deepEqual(await fundPact(db, { ...pact, status: 'EXPIRED' }, cap, new Date()), {
    funded: false,
    reason: 'wrong_status',
    status: 'EXPIRED',
  })
  assert.deepEqual(db.calls, [])
})
