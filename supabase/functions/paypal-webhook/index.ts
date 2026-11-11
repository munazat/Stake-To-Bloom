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
  const webhookId =
    Deno.env.get('PAYPAL_WEBHOOK_ID') ?? (paypal.kind === 'mock' ? 'mock-webhook' : '')
  if (!webhookId) throw new HttpError(500, 'config', 'PAYPAL_WEBHOOK_ID is not set.')
  const admin = serviceClient()
  await assertPaymentsEnabled(admin)

  const load = async (
    column: 'paypal_order_id' | 'paypal_capture_id',
    value: string,
  ): Promise<WebhookPact | null> => {
    const { data, error } = await admin
      .from('pacts')
      .select(PACT_COLUMNS)
      .eq(column, value)
      .maybeSingle()
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
      async reconcileSettlement(eventType, resource) {
        const batchId =
          typeof resource.payout_batch_id === 'string'
            ? resource.payout_batch_id
            : typeof resource.id === 'string'
              ? resource.id
              : null
        if (!batchId) return null
        const found = await admin
          .from('settlements')
          .select('id,pact_id,pool_id,plan')
          .eq('payout_batch_id', batchId)
          .maybeSingle()
        if (found.error || !found.data) return null
        const success = eventType === 'PAYMENT.PAYOUTSBATCH.SUCCESS'
        const failed = eventType !== 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED' && !success
        if (!success && !failed) return found.data.pact_id as string | null
        const { error: settlementError } = await admin
          .from('settlements')
          .update({ status: success ? 'COMPLETED' : 'NEEDS_REVIEW' })
          .eq('id', found.data.id)
        if (settlementError) throw new Error('update settlement failed')
        const plan = found.data.plan as { winnerPactIds?: string[]; loserPactIds?: string[] }
        const payoutPlan = found.data.plan as {
          items?: Array<{ pactId: string; amountCents: number }>
        }
        const pactIds = [...new Set([...(plan.winnerPactIds ?? []), ...(plan.loserPactIds ?? [])])]
        if (failed) {
          if (eventType.startsWith('PAYMENT.PAYOUTS-ITEM.')) {
            const senderItemId =
              typeof resource.sender_item_id === 'string' ? resource.sender_item_id : ''
            const itemIndex = Number(senderItemId.split('-').pop())
            const failedItem = Number.isInteger(itemIndex)
              ? payoutPlan.items?.[itemIndex]
              : undefined
            if (failedItem && senderItemId === `bloom-${failedItem.pactId}-${itemIndex}`) {
              const pact = await admin
                .from('pacts')
                .select('paypal_capture_id,stake_cents')
                .eq('id', failedItem.pactId)
                .maybeSingle()
              if (pact.error) throw new Error('load failed payout pact')
              if (pact.data?.paypal_capture_id) {
                const refund = await paypal.refundCapture({
                  captureId: pact.data.paypal_capture_id,
                  amountCents: Number(pact.data.stake_cents),
                  requestId: `bloom-refund-${pact.data.paypal_capture_id}`,
                })
                if (refund.status !== 'COMPLETED') throw new Error('stake refund is still pending')
                const { error } = await admin.from('ledger_entries').upsert(
                  {
                    pact_id: failedItem.pactId,
                    kind: 'REFUND_OUT',
                    amount_cents: pact.data.stake_cents,
                    ref: `bloom-refund-${pact.data.paypal_capture_id}`,
                  },
                  { onConflict: 'kind,ref', ignoreDuplicates: true },
                )
                if (error) throw new Error('record failed payout refund')
              }
            }
          }
          if (pactIds.length)
            await admin.rpc('transition_pacts', {
              p_pact_ids: pactIds,
              p_from: 'SETTLING',
              p_to: 'NEEDS_REVIEW',
            })
        } else {
          const winners = plan.winnerPactIds ?? []
          const losers = plan.loserPactIds ?? []
          if (winners.length) {
            const { error } = await admin.rpc('transition_pacts', {
              p_pact_ids: winners,
              p_from: 'SETTLING',
              p_to: 'SETTLED_PASS',
            })
            if (error && error.code !== '40001') throw new Error('settle pact status failed')
          }
          if (losers.length) {
            const { error } = await admin.rpc('transition_pacts', {
              p_pact_ids: losers,
              p_from: 'SETTLING',
              p_to: 'SETTLED_FAIL',
            })
            if (error && error.code !== '40001') throw new Error('settle pact status failed')
          }
        }
        return found.data.pact_id as string | null
      },
    },
    request,
  )
}

Deno.serve(withCors(handler))
