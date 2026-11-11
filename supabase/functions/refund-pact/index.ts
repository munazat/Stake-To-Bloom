import { z } from 'zod'
import { requireUserId, serviceClient } from '../_shared/auth.ts'
import { assertMethod, HttpError, json, readJsonBody, withCors } from '../_shared/http.ts'
import { assertPaymentsEnabled, paypalClientFromEnv } from '../_shared/paypal.ts'

const paypal = paypalClientFromEnv()
const Body = z.object({ pact_id: z.string().uuid() })
const handler = async (request: Request) => {
  assertMethod(request, 'POST')
  const admin = serviceClient()
  const userId = await requireUserId(request, admin)
  const { pact_id: pactId } = Body.parse(await readJsonBody(request))
  await assertPaymentsEnabled(admin)
  const { data: pact, error } = await admin
    .from('pacts')
    .select('id,user_id,status,stake_cents,starts_at,paypal_capture_id')
    .eq('id', pactId)
    .maybeSingle()
  if (error || !pact || pact.user_id !== userId)
    throw new HttpError(404, 'pact_not_found', 'Pact not found.')
  if (
    pact.status !== 'ACTIVE' ||
    !pact.paypal_capture_id ||
    !pact.starts_at ||
    new Date(pact.starts_at).getTime() <= Date.now()
  )
    throw new HttpError(
      409,
      'refund_unavailable',
      'This pact is no longer eligible for a cancellation refund.',
    )
  const { count, error: proofError } = await admin
    .from('proofs')
    .select('id', { count: 'exact', head: true })
    .eq('pact_id', pactId)
  if (proofError) throw new Error('check pact proofs failed')
  if ((count ?? 0) > 0)
    throw new HttpError(
      409,
      'proof_exists',
      'A pact with submitted proof cannot be cancelled for a refund.',
    )
  const prior = await admin
    .from('ledger_entries')
    .select('id')
    .eq('kind', 'REFUND_OUT')
    .eq('ref', `bloom-refund-${pact.paypal_capture_id}`)
    .maybeSingle()
  if (prior.error) throw new Error('check prior refund failed')
  if (prior.data) return json({ status: 'CANCELLED_REFUNDED', alreadyRefunded: true })
  const refund = await paypal.refundCapture({
    captureId: pact.paypal_capture_id,
    amountCents: Number(pact.stake_cents),
    requestId: `bloom-refund-${pact.paypal_capture_id}`,
  })
  if (refund.status !== 'COMPLETED')
    throw new HttpError(
      503,
      'refund_pending',
      'The refund is still processing; the pact was not cancelled yet.',
    )
  const { error: ledgerError } = await admin.from('ledger_entries').insert({
    pact_id: pactId,
    kind: 'REFUND_OUT',
    amount_cents: pact.stake_cents,
    ref: `bloom-refund-${pact.paypal_capture_id}`,
  })
  if (ledgerError && ledgerError.code !== '23505') throw new Error('record refund failed')
  const { error: transitionError } = await admin.rpc('transition_pact', {
    p_pact_id: pactId,
    p_from: 'ACTIVE',
    p_to: 'CANCELLED_REFUNDED',
  })
  if (transitionError)
    throw new HttpError(
      409,
      'refund_race',
      'The pact changed while the refund was processing; contact support.',
    )
  return json({ status: 'CANCELLED_REFUNDED', refundId: refund.id })
}
Deno.serve(withCors(handler))
