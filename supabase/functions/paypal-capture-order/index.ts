/**
 * paypal-capture-order — body { order_id, mode?: "capture" | "check" }.
 *
 * The user id comes from the verified JWT; the order must belong to one of that
 * user's pacts or the answer is 403 (invariant I2).
 */
import { z } from 'zod'
import { requireUserId, serviceClient } from '../_shared/auth.ts'
import { supabaseEventSink } from '../_shared/events.ts'
import { supabaseFundingDb } from '../_shared/funding.ts'
import { assertMethod, json, readJsonBody, withCors } from '../_shared/http.ts'
import { assertPaymentsEnabled, paypalClientFromEnv } from '../_shared/paypal.ts'
import { captureFlow } from './flow.ts'

const RequestSchema = z.object({
  order_id: z.string().min(1).max(100),
  mode: z.enum(['capture', 'check']).default('capture'),
})

const paypal = paypalClientFromEnv()

const handler = async (request: Request): Promise<Response> => {
  assertMethod(request, 'POST')
  const admin = serviceClient()
  const userId = await requireUserId(request, admin)
  const body = RequestSchema.parse(await readJsonBody(request))
  await assertPaymentsEnabled(admin)

  const outcome = await captureFlow(
    {
      paypal,
      events: supabaseEventSink(admin),
      funding: supabaseFundingDb(admin),
      payee: {
        merchantId: Deno.env.get('PAYPAL_MERCHANT_ID') || undefined,
        email: Deno.env.get('PAYPAL_BUSINESS_EMAIL') || undefined,
      },
      now: () => new Date(),
      async loadPactByOrder(orderId) {
        const { data, error } = await admin
          .from('pacts')
          .select('id, user_id, status, stake_cents, currency, tz, paypal_order_id')
          .eq('paypal_order_id', orderId)
          .maybeSingle()
        if (error) throw new Error('load pact failed')
        return data
      },
    },
    userId,
    body.order_id,
    body.mode,
  )
  return json(outcome)
}

Deno.serve(withCors(handler))
