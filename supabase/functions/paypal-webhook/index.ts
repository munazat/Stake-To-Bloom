/**
 * paypal-webhook — PayPal calls this, not a browser. JWT verification is OFF in
 * config.toml because PayPal cannot send one; the PayPal signature is the
 * authentication instead (see flow.ts).
 */
import { serviceClient } from '../_shared/auth.ts'
import { supabaseEventSink } from '../_shared/events.ts'
import { supabaseFundingDb } from '../_shared/funding.ts'
import { HttpError, assertMethod, withCors } from '../_shared/http.ts'
import { assertPaymentsEnabled, paypalClientFromEnv } from '../_shared/paypal.ts'
import { handleWebhook, type WebhookPact } from './flow.ts'

const paypal = paypalClientFromEnv()
const PACT_COLUMNS = 'id, user_id, status, stake_cents, currency, tz, paypal_order_id'

const handler = async (request: Request): Promise<Response> => {
  assertMethod(request, 'POST')
  const webhookId = Deno.env.get('PAYPAL_WEBHOOK_ID') ?? (paypal.kind === 'mock' ? 'mock-webhook' : '')
  if (!webhookId) throw new HttpError(500, 'config', 'PAYPAL_WEBHOOK_ID is not set.')
  const admin = serviceClient()
  await assertPaymentsEnabled(admin)

  const load = async (column: 'paypal_order_id' | 'paypal_capture_id', value: string): Promise<WebhookPact | null> => {
    const { data, error } = await admin.from('pacts').select(PACT_COLUMNS).eq(column, value).maybeSingle()
    if (error) throw new Error('load pact failed')
    return data
  }

  return handleWebhook(
    {
      paypal,
      webhookId,
      events: supabaseEventSink(admin),
      funding: supabaseFundingDb(admin),
      payee: {
        merchantId: Deno.env.get('PAYPAL_MERCHANT_ID') || undefined,
        email: Deno.env.get('PAYPAL_BUSINESS_EMAIL') || undefined,
      },
      now: () => new Date(),
      loadPactByOrder: (id) => load('paypal_order_id', id),
      loadPactByCapture: (id) => load('paypal_capture_id', id),
      async flagForReview(pactId) {
        const { error } = await admin.rpc('transition_pact', {
          p_pact_id: pactId,
          p_from: 'ACTIVE',
          p_to: 'NEEDS_REVIEW',
        })
        if (error?.code === '40001') return 'skipped'
        if (error) throw new Error('flag for review failed')
        return 'moved'
      },
    },
    request,
  )
}

Deno.serve(withCors(handler))
