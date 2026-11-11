/**
 * paypal-create-order — body { pact_id }. Returns only the PayPal order id.
 */
import { z } from 'zod'
import { requireUserId, serviceClient } from '../_shared/auth.ts'
import { supabaseEventSink } from '../_shared/events.ts'
import { allowedOrigins } from '../_shared/cors.ts'
import { assertMethod, json, readJsonBody, withCors } from '../_shared/http.ts'
import { assertPaymentsEnabled, paypalClientFromEnv } from '../_shared/paypal.ts'
import { createOrderFlow } from './flow.ts'

const RequestSchema = z.object({ pact_id: z.string().uuid() })

// Resolved at boot: a non-sandbox configuration or a hosted mock throws here.
const paypal = paypalClientFromEnv()

const handler = async (request: Request): Promise<Response> => {
  assertMethod(request, 'POST')
  const admin = serviceClient()
  const userId = await requireUserId(request, admin)
  const { pact_id } = RequestSchema.parse(await readJsonBody(request))
  await assertPaymentsEnabled(admin)

  const result = await createOrderFlow(
    {
      paypal,
      events: supabaseEventSink(admin),
      returnUrl: allowedOrigins()[0] ?? 'http://localhost:5173',
      async loadPact(id) {
        const { data, error } = await admin
          .from('pacts')
          .select('id, user_id, status, stake_cents, currency, paypal_order_id')
          .eq('id', id)
          .maybeSingle()
        if (error) throw new Error('load pact failed')
        return data
      },
      async countOrders(id) {
        const { count, error } = await admin
          .from('paypal_events')
          .select('id', { count: 'exact', head: true })
          .eq('pact_id', id)
          .eq('event_type', 'CHECKOUT.ORDER.CREATED')
        if (error) throw new Error('count orders failed')
        return count ?? 0
      },
      async saveOrderId(id, orderId) {
        const { error } = await admin.from('pacts').update({ paypal_order_id: orderId }).eq('id', id).eq('status', 'AWAITING_STAKE')
        if (error) throw new Error('save order id failed')
      },
    },
    userId,
    pact_id,
  )
  return json({ order_id: result.orderId, resumed: result.resumed }, 201)
}

Deno.serve(withCors(handler))
