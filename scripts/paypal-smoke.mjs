#!/usr/bin/env node
/**
 * paypal-smoke.mjs — prove the PayPal SANDBOX credentials and request shapes work
 * before any UI depends on them (brief §11.7 step 9).
 *
 * Sandbox only: the script refuses any other host. It reads credentials from
 * supabase/functions/.env (gitignored) or the environment, and never prints them.
 *
 *   node scripts/paypal-smoke.mjs                  token + create a $5 order, print the buyer approval link
 *   node scripts/paypal-smoke.mjs --capture <id>   capture an order the buyer approved in the browser
 *   node scripts/paypal-smoke.mjs --refund <capId> refund a capture in full
 *   node scripts/paypal-smoke.mjs --payout         send a $1 payout to PAYPAL_CHARITY_EMAIL (needs Payouts enabled)
 *   node scripts/paypal-smoke.mjs --webhook <url>  register the webhook at <url> (prints the id for PAYPAL_WEBHOOK_ID)
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const BASE = 'https://api-m.sandbox.paypal.com'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function loadEnv() {
  const env = { ...process.env }
  const file = resolve(root, 'supabase/functions/.env')
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
      if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
  return env
}

const env = loadEnv()
if ((env.PAYPAL_ENV ?? 'sandbox') !== 'sandbox') throw new Error('PAYPAL_ENV must be sandbox')
if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) throw new Error('PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET missing')

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  return i === -1 ? undefined : (args[i + 1] ?? true)
}

async function token() {
  const basic = Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString('base64')
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  })
  if (!res.ok) throw new Error(`token failed: HTTP ${res.status}`)
  return (await res.json()).access_token
}

async function call(t, path, method, body, requestId) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${t}`,
      'content-type': 'application/json',
      ...(requestId ? { 'paypal-request-id': requestId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    console.error(`FAIL ${method} ${path} -> HTTP ${res.status}`, JSON.stringify(json?.details ?? json?.name ?? json))
    process.exit(1)
  }
  return json
}

const t = await token()
console.log('ok  token acquired')

const captureId = flag('--capture')
const refundId = flag('--refund')
if (captureId) {
  const o = await call(t, `/v2/checkout/orders/${captureId}/capture`, 'POST', {}, `smoke-capture-${captureId}`)
  const cap = o.purchase_units?.[0]?.payments?.captures?.[0]
  console.log(`ok  capture ${cap?.id} status=${cap?.status} amount=${cap?.amount?.value} ${cap?.amount?.currency_code}`)
} else if (refundId) {
  const r = await call(t, `/v2/payments/captures/${refundId}/refund`, 'POST', {}, `smoke-refund-${refundId}`)
  console.log(`ok  refund ${r.id} status=${r.status}`)
} else if (flag('--payout')) {
  if (!env.PAYPAL_CHARITY_EMAIL) throw new Error('PAYPAL_CHARITY_EMAIL missing')
  const batch = `smoke-${Date.now()}`
  const p = await call(
    t,
    '/v1/payments/payouts',
    'POST',
    {
      sender_batch_header: { sender_batch_id: batch, email_subject: 'BloomStake sandbox smoke test' },
      items: [
        {
          recipient_type: 'EMAIL',
          receiver: env.PAYPAL_CHARITY_EMAIL,
          amount: { value: '1.00', currency: 'USD' },
          sender_item_id: `${batch}-1`,
          recipient_wallet: 'PAYPAL',
        },
      ],
    },
    batch,
  )
  console.log(`ok  payout batch ${p.batch_header?.payout_batch_id} status=${p.batch_header?.batch_status}`)
} else if (flag('--webhook')) {
  const url = flag('--webhook')
  const w = await call(t, '/v1/notifications/webhooks', 'POST', {
    url,
    event_types: [
      { name: 'PAYMENT.CAPTURE.COMPLETED' },
      { name: 'PAYMENT.CAPTURE.DENIED' },
      { name: 'PAYMENT.CAPTURE.REVERSED' },
      { name: 'PAYMENT.CAPTURE.REFUNDED' },
      { name: 'PAYMENT.PAYOUTSBATCH.SUCCESS' },
      { name: 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED' },
      { name: 'PAYMENT.PAYOUTS-ITEM.DENIED' },
      { name: 'PAYMENT.PAYOUTS-ITEM.UNCLAIMED' },
      { name: 'PAYMENT.PAYOUTS-ITEM.RETURNED' },
      { name: 'PAYMENT.PAYOUTS-ITEM.FAILED' },
    ],
  })
  console.log(`ok  webhook registered, id=${w.id}  (set it as the PAYPAL_WEBHOOK_ID secret)`)
} else {
  const id = `smoke-order-${Date.now()}`
  const o = await call(
    t,
    '/v2/checkout/orders',
    'POST',
    {
      intent: 'CAPTURE',
      purchase_units: [
        { reference_id: id, custom_id: id, amount: { currency_code: 'USD', value: '5.00' }, description: 'BloomStake smoke test' },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            shipping_preference: 'NO_SHIPPING',
            user_action: 'PAY_NOW',
            return_url: 'http://localhost:5173',
            cancel_url: 'http://localhost:5173',
          },
        },
      },
    },
    id,
  )
  const approve = o.links?.find((l) => l.rel === 'payer-action' || l.rel === 'approve')?.href
  console.log(`ok  order ${o.id} status=${o.status}`)
  console.log(`    approve it once as a sandbox buyer: ${approve}`)
  console.log(`    then: node scripts/paypal-smoke.mjs --capture ${o.id}`)
}
