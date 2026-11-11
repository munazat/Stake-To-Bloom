/** paypal_test.ts — I4/I7/I10 for the PayPal client, no network. Run: npm run test:functions */
import assert from 'node:assert/strict'
import { HttpError } from './http.ts'
import {
  PaypalError,
  SANDBOX_BASE_URL,
  assertPaymentsEnabled,
  assertSandbox,
  centsToPaypalString,
  createMockPaypalClient,
  createPaypalClient,
  looksHosted,
  paypalClientFromEnv,
} from './paypal.ts'

const PACT_ID = '0c0c0c0c-0000-4000-8000-000000000003'
const env = (vars: Record<string, string>) => (name: string) => vars[name]

Deno.test('amount strings are built from integer cents', () => {
  assert.equal(centsToPaypalString(2000), '20.00')
  assert.equal(centsToPaypalString(505), '5.05')
  assert.equal(centsToPaypalString(5), '0.05')
  assert.throws(() => centsToPaypalString(10.5))
})

Deno.test('I7: only the sandbox host and mode are accepted', () => {
  assert.equal(assertSandbox(env({})), SANDBOX_BASE_URL)
  assert.equal(assertSandbox(env({ PAYPAL_ENV: 'sandbox' })), SANDBOX_BASE_URL)
  assert.throws(() => assertSandbox(env({ PAYPAL_ENV: 'live' })), /sandbox/)
  assert.throws(() => assertSandbox(env({ PAYPAL_ENV: 'production' })), /sandbox/)
  assert.throws(() => assertSandbox(env({ PAYPAL_BASE_URL: 'https://api-m.paypal.com' })), /base URL/)
  assert.throws(() => assertSandbox(env({ PAYPAL_BASE_URL: 'https://evil.example' })), /base URL/)
  assert.throws(
    () => createPaypalClient({ clientId: 'a', clientSecret: 'b', baseUrl: 'https://api-m.paypal.com' }),
    /sandbox/,
  )
})

Deno.test('the mock adapter refuses to run on a hosted Supabase project', () => {
  assert.equal(looksHosted('https://abcdef.supabase.co'), true)
  assert.equal(looksHosted('http://127.0.0.1:54321'), false)
  assert.equal(looksHosted('http://kong:8000'), false)
  assert.throws(
    () => paypalClientFromEnv(env({ PAYMENTS_ADAPTER: 'mock', SUPABASE_URL: 'https://abcdef.supabase.co' })),
    /local development only/,
  )
  assert.equal(paypalClientFromEnv(env({ PAYMENTS_ADAPTER: 'mock', SUPABASE_URL: 'http://kong:8000' })).kind, 'mock')
  assert.throws(() => paypalClientFromEnv(env({ PAYPAL_ENV: 'sandbox' })), HttpError) // credentials missing
})

function scripted(responses: Array<Response | Error>) {
  const calls: Array<{ url: string; method: string; headers: Headers; body: string | null }> = []
  const fetcher: typeof fetch = (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: (init?.body as string | undefined) ?? null,
    })
    const next = responses.shift()
    if (!next) throw new Error('unexpected extra fetch')
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next)
  }
  return { fetcher, calls }
}

const tokenResponse = () => Response.json({ access_token: 'T1', expires_in: 3600 })

Deno.test('the OAuth token is cached until shortly before it expires', async () => {
  let clock = 0
  const { fetcher, calls } = scripted([
    tokenResponse(),
    Response.json({ id: 'O1', status: 'CREATED' }),
    Response.json({ id: 'O2', status: 'CREATED' }),
    tokenResponse(),
    Response.json({ id: 'O3', status: 'CREATED' }),
  ])
  const client = createPaypalClient({
    clientId: 'id',
    clientSecret: 'secret',
    fetch: fetcher,
    now: () => clock,
    sleep: () => Promise.resolve(),
  })
  const input = { pactId: PACT_ID, stakeCents: 2000, attempt: 1, returnUrl: 'http://x' }
  await client.createOrder(input)
  await client.createOrder({ ...input, attempt: 2 })
  assert.equal(calls.filter((c) => c.url.endsWith('/v1/oauth2/token')).length, 1)
  clock = 3_600_000 - 30_000 // inside the 60 s safety margin
  await client.createOrder({ ...input, attempt: 3 })
  assert.equal(calls.filter((c) => c.url.endsWith('/v1/oauth2/token')).length, 2)
})

Deno.test('createOrder sends the pact id, a deterministic request id and a cents-built amount', async () => {
  const { fetcher, calls } = scripted([tokenResponse(), Response.json({ id: 'O1', status: 'CREATED' })])
  const client = createPaypalClient({ clientId: 'id', clientSecret: 'secret', fetch: fetcher })
  await client.createOrder({ pactId: PACT_ID, stakeCents: 2050, attempt: 2, returnUrl: 'http://x' })
  const call = calls[1]
  assert.equal(call.url, `${SANDBOX_BASE_URL}/v2/checkout/orders`)
  assert.equal(call.headers.get('paypal-request-id'), `bloom-order-${PACT_ID}-2`)
  assert.equal(call.headers.get('authorization'), 'Bearer T1')
  const body = JSON.parse(call.body ?? '{}')
  assert.equal(body.intent, 'CAPTURE')
  assert.equal(body.purchase_units[0].custom_id, PACT_ID)
  assert.deepEqual(body.purchase_units[0].amount, { currency_code: 'USD', value: '20.50' })
})

Deno.test('I4: a 5xx is retried with the SAME request id; a 4xx is not retried', async () => {
  const { fetcher, calls } = scripted([
    tokenResponse(),
    new Response('boom', { status: 503 }),
    new Error('network down'),
    Response.json({ id: 'ORDER-9', status: 'COMPLETED', purchase_units: [] }),
  ])
  const client = createPaypalClient({
    clientId: 'id',
    clientSecret: 'secret',
    fetch: fetcher,
    sleep: () => Promise.resolve(),
  })
  const order = await client.captureOrder('ORDER-9')
  assert.equal(order.status, 'COMPLETED')
  const captures = calls.filter((c) => c.url.endsWith('/capture'))
  assert.equal(captures.length, 3)
  for (const c of captures) assert.equal(c.headers.get('paypal-request-id'), 'bloom-capture-ORDER-9')

  const four = scripted([
    tokenResponse(),
    Response.json(
      { name: 'UNPROCESSABLE_ENTITY', debug_id: 'dbg', details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] },
      { status: 422 },
    ),
  ])
  const c2 = createPaypalClient({ clientId: 'id', clientSecret: 'secret', fetch: four.fetcher })
  await assert.rejects(
    c2.captureOrder('X'),
    (err: unknown) => err instanceof PaypalError && err.issue === 'ORDER_ALREADY_CAPTURED' && err.status === 422,
  )
  assert.equal(four.calls.length, 2)
})

Deno.test('webhook verification sends PayPal the transmission headers and the webhook id', async () => {
  const { fetcher, calls } = scripted([
    tokenResponse(),
    Response.json({ verification_status: 'SUCCESS' }),
    Response.json({ verification_status: 'FAILURE' }),
  ])
  const client = createPaypalClient({ clientId: 'id', clientSecret: 'secret', fetch: fetcher })
  const headers = new Headers({
    'paypal-auth-algo': 'SHA256withRSA',
    'paypal-cert-url': 'https://api.sandbox.paypal.com/cert',
    'paypal-transmission-id': 'tid',
    'paypal-transmission-sig': 'sig',
    'paypal-transmission-time': '2026-11-11T00:00:00Z',
  })
  assert.equal(await client.verifyWebhook({ headers, webhookId: 'WH1', event: { id: 'E1' } }), true)
  const body = JSON.parse(calls[1].body ?? '{}')
  assert.equal(body.webhook_id, 'WH1')
  assert.equal(body.transmission_id, 'tid')
  assert.deepEqual(body.webhook_event, { id: 'E1' })
  assert.equal(await client.verifyWebhook({ headers, webhookId: 'WH1', event: {} }), false)
})

Deno.test('mock adapter: reads are unpaid, a capture is COMPLETED and carries the pact id', async () => {
  const mock = createMockPaypalClient()
  const { id } = await mock.createOrder({ pactId: PACT_ID, stakeCents: 2000, attempt: 1, returnUrl: '' })
  assert.equal((await mock.getOrder(id)).status, 'CREATED')
  const captured = await mock.captureOrder(id)
  assert.equal(captured.status, 'COMPLETED')
  assert.equal(captured.purchase_units[0].payments?.captures?.[0].custom_id, PACT_ID)
  assert.equal(captured.purchase_units[0].amount?.value, '20.00')
  await assert.rejects(mock.getOrder('REAL-LOOKING-ID'), PaypalError)
})

Deno.test('I10: payments_enabled must be exactly true, else 503', async () => {
  const admin = (value: unknown) =>
    // deno-lint-ignore no-explicit-any
    ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: value === undefined ? null : { value }, error: null }),
          }),
        }),
      }),
    }) as any
  await assertPaymentsEnabled(admin(true))
  for (const off of [false, 'true', null, undefined]) {
    await assert.rejects(assertPaymentsEnabled(admin(off)), (e: unknown) => e instanceof HttpError && e.status === 503)
  }
})
