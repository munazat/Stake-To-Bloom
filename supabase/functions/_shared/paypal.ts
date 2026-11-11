/**
 * paypal.ts — the only code that talks to PayPal.
 *
 * Plain `fetch`, no SDK (fewer Deno compatibility problems). Everything here is
 * injectable (`fetch`, `sleep`, `now`) so the tests never touch the network.
 *
 * Invariants enforced in this file:
 *   I7  sandbox only — `assertSandbox()` refuses any base URL that is not the
 *       sandbox host, and refuses PAYPAL_ENV values other than "sandbox".
 *   I4  every money call carries a deterministic `PayPal-Request-Id`, and a
 *       retry reuses the SAME id, so a timeout can never double-charge.
 *   I10 `assertPaymentsEnabled()` turns the kill switch into a 503.
 *
 * The mock adapter (decision D12) is local development only. It refuses to
 * exist anywhere that looks like a hosted Supabase project.
 */
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { centsToUsdString } from './core/index.ts'
import { HttpError } from './http.ts'

export const SANDBOX_BASE_URL = 'https://api-m.sandbox.paypal.com'

/** Amount strings are built from integer cents, never from a float. */
export function centsToPaypalString(cents: number): string {
  return centsToUsdString(cents)
}

// ---------------------------------------------------------------------------
// I7 — sandbox only
// ---------------------------------------------------------------------------

type EnvReader = (name: string) => string | undefined

const denoEnv: EnvReader = (name) => Deno.env.get(name)

/** Throws unless the configuration points at the PayPal sandbox and nothing else. */
export function assertSandbox(env: EnvReader = denoEnv): string {
  const mode = (env('PAYPAL_ENV') ?? 'sandbox').trim().toLowerCase()
  if (mode !== 'sandbox') {
    throw new Error(
      `PAYPAL_ENV must be "sandbox" (got "${mode}"). BloomStake never touches real money.`,
    )
  }
  const base = (env('PAYPAL_BASE_URL') ?? SANDBOX_BASE_URL).trim().replace(/\/+$/, '')
  if (base !== SANDBOX_BASE_URL) {
    throw new Error(`PayPal base URL must be ${SANDBOX_BASE_URL} (got ${base}).`)
  }
  return base
}

// ---------------------------------------------------------------------------
// Response shapes (only the fields we read; everything else is dropped)
// ---------------------------------------------------------------------------

const AmountSchema = z.object({ currency_code: z.string(), value: z.string() })

export const CaptureSchema = z.object({
  id: z.string(),
  status: z.string(),
  amount: AmountSchema.optional(),
  custom_id: z.string().optional(),
  invoice_id: z.string().optional(),
})
export type PaypalCapture = z.infer<typeof CaptureSchema>

export const OrderSchema = z.object({
  id: z.string(),
  status: z.string(),
  payer: z
    .object({ email_address: z.string().optional(), payer_id: z.string().optional() })
    .optional(),
  purchase_units: z
    .array(
      z.object({
        reference_id: z.string().optional(),
        custom_id: z.string().optional(),
        invoice_id: z.string().optional(),
        amount: AmountSchema.optional(),
        payee: z
          .object({ merchant_id: z.string().optional(), email_address: z.string().optional() })
          .optional(),
        payments: z.object({ captures: z.array(CaptureSchema).optional() }).optional(),
      }),
    )
    .default([]),
})
export type PaypalOrder = z.infer<typeof OrderSchema>

export interface CreateOrderInput {
  pactId: string
  stakeCents: number
  attempt: number
  returnUrl: string
}

export interface WebhookVerifyInput {
  headers: Headers
  webhookId: string
  /** Original UTF-8 JSON bytes, preserved for PayPal's postback signature check. */
  rawEventBody: string
}

/** What the money functions need from PayPal. Real, mock and test fakes all satisfy it. */
export interface PaypalClient {
  readonly kind: 'sandbox' | 'mock'
  createOrder(input: CreateOrderInput): Promise<{ id: string; status: string }>
  getOrder(orderId: string): Promise<PaypalOrder>
  captureOrder(orderId: string): Promise<PaypalOrder>
  createPayout(input: {
    batchId: string
    items: Array<{ id: string; email: string; amountCents: number }>
  }): Promise<{ batchId: string; status: string }>
  getPayout(batchId: string): Promise<{ batchId: string; status: string }>
  refundCapture(input: {
    captureId: string
    amountCents: number
    requestId: string
  }): Promise<{ id: string; status: string }>
  verifyWebhook(input: WebhookVerifyInput): Promise<boolean>
}

/** A PayPal API refusal. `issue` is PayPal's own machine code, e.g. ORDER_ALREADY_CAPTURED. */
export class PaypalError extends Error {
  readonly status: number
  readonly issue: string | null
  readonly debugId: string | null

  constructor(status: number, issue: string | null, debugId: string | null, message: string) {
    super(message)
    this.name = 'PaypalError'
    this.status = status
    this.issue = issue
    this.debugId = debugId
  }
}

// ---------------------------------------------------------------------------
// Real client
// ---------------------------------------------------------------------------

export interface PaypalClientOptions {
  clientId: string
  clientSecret: string
  baseUrl?: string
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  /** Attempts per call on a 5xx or a network error. Default 3. */
  maxAttempts?: number
}

const TOKEN_SAFETY_MS = 60_000
const RETRY_DELAYS_MS = [400, 1200]

export function createPaypalClient(options: PaypalClientOptions): PaypalClient {
  const baseUrl = (options.baseUrl ?? SANDBOX_BASE_URL).replace(/\/+$/, '')
  if (baseUrl !== SANDBOX_BASE_URL) throw new Error('refusing a non-sandbox PayPal base URL (I7)')
  const doFetch = options.fetch ?? fetch
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const now = options.now ?? Date.now
  const maxAttempts = options.maxAttempts ?? 3

  let cached: { token: string; expiresAt: number } | null = null

  async function accessToken(): Promise<string> {
    if (cached && cached.expiresAt - TOKEN_SAFETY_MS > now()) return cached.token
    const basic = btoa(`${options.clientId}:${options.clientSecret}`)
    const response = await doFetch(`${baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    })
    if (!response.ok) {
      throw new PaypalError(response.status, null, null, 'PayPal rejected the API credentials.')
    }
    const body = z
      .object({ access_token: z.string(), expires_in: z.number() })
      .parse(await response.json())
    cached = { token: body.access_token, expiresAt: now() + body.expires_in * 1000 }
    return body.access_token
  }

  /**
   * One PayPal call. A 5xx or a network failure is retried with the SAME request
   * id; a 4xx is final (it is a decision, not an outage).
   */
  async function paypalFetch(
    path: string,
    init: { method: 'GET' | 'POST'; body?: unknown; rawBody?: string; requestId?: string },
  ): Promise<unknown> {
    let lastError: unknown = null
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const token = await accessToken()
        const headers: Record<string, string> = {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
        }
        if (init.body !== undefined || init.rawBody !== undefined)
          headers['content-type'] = 'application/json'
        if (init.requestId) headers['paypal-request-id'] = init.requestId
        const response = await doFetch(`${baseUrl}${path}`, {
          method: init.method,
          headers,
          body: init.rawBody ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
        })
        if (response.status === 401) cached = null // token revoked early; fetch a new one next time
        if (response.status >= 500 || response.status === 401) {
          lastError = new PaypalError(
            response.status,
            null,
            response.headers.get('paypal-debug-id'),
            'PayPal is unavailable.',
          )
        } else {
          const payload: unknown = await response.json().catch(() => null)
          if (!response.ok) {
            const p = (payload ?? {}) as {
              name?: string
              debug_id?: string
              message?: string
              details?: Array<{ issue?: string }>
            }
            throw new PaypalError(
              response.status,
              p.details?.[0]?.issue ?? p.name ?? null,
              p.debug_id ?? response.headers.get('paypal-debug-id'),
              p.message ?? 'PayPal rejected the request.',
            )
          }
          return payload
        }
      } catch (err) {
        if (err instanceof PaypalError && err.status < 500 && err.status !== 401) throw err
        lastError = err
      }
      if (attempt < maxAttempts) await sleep(RETRY_DELAYS_MS[attempt - 1] ?? 1200)
    }
    throw lastError instanceof Error ? lastError : new Error('PayPal call failed')
  }

  return {
    kind: 'sandbox',

    async createOrder(input) {
      const short = input.pactId.replace(/-/g, '').slice(0, 8).toUpperCase()
      const payload = await paypalFetch('/v2/checkout/orders', {
        method: 'POST',
        requestId: `bloom-order-${input.pactId}-${input.attempt}`,
        body: {
          intent: 'CAPTURE',
          purchase_units: [
            {
              reference_id: input.pactId,
              custom_id: input.pactId,
              invoice_id: `BLOOM-${short}-${input.attempt}`,
              description: 'BloomStake pact stake (sandbox)',
              amount: { currency_code: 'USD', value: centsToPaypalString(input.stakeCents) },
            },
          ],
          payment_source: {
            paypal: {
              experience_context: {
                brand_name: 'BloomStake',
                shipping_preference: 'NO_SHIPPING',
                user_action: 'PAY_NOW',
                return_url: input.returnUrl,
                cancel_url: input.returnUrl,
              },
            },
          },
        },
      })
      return z.object({ id: z.string(), status: z.string() }).parse(payload)
    },

    async getOrder(orderId) {
      return OrderSchema.parse(
        await paypalFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, { method: 'GET' }),
      )
    },

    async captureOrder(orderId) {
      return OrderSchema.parse(
        await paypalFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
          method: 'POST',
          requestId: `bloom-capture-${orderId}`,
          body: {},
        }),
      )
    },

    async createPayout(input) {
      const payload = (await paypalFetch('/v1/payments/payouts', {
        method: 'POST',
        requestId: input.batchId,
        body: {
          sender_batch_header: {
            sender_batch_id: input.batchId,
            email_subject: 'Your BloomStake settlement',
          },
          items: input.items.map((item) => ({
            sender_item_id: item.id,
            recipient_type: 'EMAIL',
            receiver: item.email,
            amount: { value: centsToPaypalString(item.amountCents), currency: 'USD' },
            recipient_wallet: 'PAYPAL',
          })),
        },
      })) as { batch_header?: { payout_batch_id?: string; batch_status?: string } }
      if (!payload.batch_header?.payout_batch_id)
        throw new Error('PayPal payout response had no batch id')
      return {
        batchId: payload.batch_header.payout_batch_id,
        status: payload.batch_header.batch_status ?? 'PENDING',
      }
    },

    async getPayout(batchId) {
      const payload = (await paypalFetch(`/v1/payments/payouts/${encodeURIComponent(batchId)}`, {
        method: 'GET',
      })) as { batch_header?: { payout_batch_id?: string; batch_status?: string } }
      return {
        batchId: payload.batch_header?.payout_batch_id ?? batchId,
        status: payload.batch_header?.batch_status ?? 'UNKNOWN',
      }
    },

    async refundCapture(input) {
      const payload = (await paypalFetch(
        `/v2/payments/captures/${encodeURIComponent(input.captureId)}/refund`,
        {
          method: 'POST',
          requestId: input.requestId,
          body: { amount: { value: centsToPaypalString(input.amountCents), currency_code: 'USD' } },
        },
      )) as { id?: string; status?: string }
      if (!payload.id) throw new Error('PayPal refund response had no id')
      return { id: payload.id, status: payload.status ?? 'PENDING' }
    },

    async verifyWebhook({ headers, webhookId, rawEventBody }) {
      const fields = {
        auth_algo: headers.get('paypal-auth-algo'),
        cert_url: headers.get('paypal-cert-url'),
        transmission_id: headers.get('paypal-transmission-id'),
        transmission_sig: headers.get('paypal-transmission-sig'),
        transmission_time: headers.get('paypal-transmission-time'),
        webhook_id: webhookId,
      }
      const verificationBody = `{${Object.entries(fields)
        .map(([key, value]) => `${JSON.stringify(key)}:${JSON.stringify(value)}`)
        .join(',')},"webhook_event":${rawEventBody}}`
      const payload = await paypalFetch('/v1/notifications/verify-webhook-signature', {
        method: 'POST',
        rawBody: verificationBody,
      })
      return (payload as { verification_status?: string } | null)?.verification_status === 'SUCCESS'
    },
  }
}

// ---------------------------------------------------------------------------
// Mock adapter (D12) — local development only
// ---------------------------------------------------------------------------

const MOCK_PREFIX = 'MOCK-ORDER'

/** True when the Supabase URL looks like a hosted project. The mock must never run there. */
export function looksHosted(supabaseUrl: string | undefined): boolean {
  if (!supabaseUrl) return false
  try {
    const host = new URL(supabaseUrl).hostname.toLowerCase()
    return /(^|\.)supabase\.(co|in|net|com)$/.test(host)
  } catch {
    return false
  }
}

/**
 * Stateless stand-in for PayPal. An order id carries what the mock needs, so a
 * fresh function instance can "capture" an order it never created. It reports
 * every order as unpaid on a read (so the reconcile hook never funds a pact the
 * user has not "paid") and COMPLETED on a capture.
 */
export function createMockPaypalClient(): PaypalClient {
  const parse = (orderId: string) => {
    const [prefix, pactId, cents] = orderId.split('.')
    if (prefix !== MOCK_PREFIX || !pactId || !/^\d+$/.test(cents ?? '')) {
      throw new PaypalError(404, 'INVALID_RESOURCE_ID', null, 'Unknown mock order.')
    }
    return { pactId, cents: Number(cents) }
  }
  const orderBody = (orderId: string, status: string, paid: boolean): PaypalOrder => {
    const { pactId, cents } = parse(orderId)
    const amount = { currency_code: 'USD', value: centsToPaypalString(cents) }
    return {
      id: orderId,
      status,
      payer: paid
        ? { email_address: 'mock.buyer@example.com', payer_id: 'MOCKPAYER0001' }
        : undefined,
      purchase_units: [
        {
          reference_id: pactId,
          custom_id: pactId,
          amount,
          payments: paid
            ? {
                captures: [
                  { id: `MOCK-CAPTURE.${pactId}`, status: 'COMPLETED', amount, custom_id: pactId },
                ],
              }
            : undefined,
        },
      ],
    }
  }
  return {
    kind: 'mock',
    createOrder: (input) =>
      Promise.resolve({
        id: `${MOCK_PREFIX}.${input.pactId}.${input.stakeCents}.${input.attempt}`,
        status: 'CREATED',
      }),
    getOrder: (orderId) => Promise.resolve().then(() => orderBody(orderId, 'CREATED', false)),
    captureOrder: (orderId) => Promise.resolve().then(() => orderBody(orderId, 'COMPLETED', true)),
    createPayout: ({ batchId }) =>
      Promise.resolve({ batchId: `MOCK-${batchId}`, status: 'SUCCESS' }),
    getPayout: (batchId) => Promise.resolve({ batchId, status: 'SUCCESS' }),
    refundCapture: ({ captureId }) =>
      Promise.resolve({ id: `MOCK-REFUND.${captureId}`, status: 'COMPLETED' }),
    verifyWebhook: ({ headers }) => Promise.resolve(headers.get('x-mock-webhook') === 'valid'),
  }
}

/**
 * Build the client for this deployment. Throws (so the function refuses to
 * serve) when the sandbox assertion fails, when credentials are missing, or when
 * the mock adapter is requested on a hosted project.
 */
export function paypalClientFromEnv(env: EnvReader = denoEnv): PaypalClient {
  if ((env('PAYMENTS_ADAPTER') ?? '').trim().toLowerCase() === 'mock') {
    if (looksHosted(env('SUPABASE_URL'))) {
      throw new Error(
        'PAYMENTS_ADAPTER=mock is for local development only; refusing to start on a hosted project.',
      )
    }
    return createMockPaypalClient()
  }
  const baseUrl = assertSandbox(env)
  const clientId = env('PAYPAL_CLIENT_ID')
  const clientSecret = env('PAYPAL_CLIENT_SECRET')
  if (!clientId || !clientSecret) {
    throw new HttpError(
      500,
      'config',
      'PayPal sandbox credentials are missing from the function environment.',
    )
  }
  return createPaypalClient({ clientId, clientSecret, baseUrl })
}

// ---------------------------------------------------------------------------
// I10 — kill switch
// ---------------------------------------------------------------------------

/** 503 unless `app_config.payments_enabled` is exactly true. Read on every request. */
export async function assertPaymentsEnabled(admin: SupabaseClient): Promise<void> {
  const { data, error } = await admin
    .from('app_config')
    .select('value')
    .eq('key', 'payments_enabled')
    .maybeSingle()
  if (error) throw new Error('read payments_enabled failed')
  if (data?.value !== true) {
    throw new HttpError(
      503,
      'payments_disabled',
      'Payments are switched off right now. Nothing was charged.',
    )
  }
}
