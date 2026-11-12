import { serviceClient } from '../_shared/auth.ts'
import { assertMethod, HttpError, json, secretMatches, withCors } from '../_shared/http.ts'
import { paypalClientFromEnv } from '../_shared/paypal.ts'

const paypal = paypalClientFromEnv()
const handler = async (request: Request) => {
  assertMethod(request, 'POST')
  const secret = Deno.env.get('CRON_SECRET') ?? ''
  if (!secretMatches(request.headers.get('authorization') ?? '', `Bearer ${secret}`) || !secret)
    throw new HttpError(401, 'unauthorized', 'A valid cron secret is required.')
  const admin = serviceClient()
  const { data: rows, error } = await admin
    .from('settlements')
    .select('id,pact_id,pool_id,plan,payout_batch_id')
    .eq('status', 'EXECUTING')
    .not('payout_batch_id', 'is', null)
  if (error) throw new Error('load pending settlements failed')
  const results: Array<{ id: string; status: string }> = []
  for (const row of rows ?? []) {
    if (!row.payout_batch_id || row.payout_batch_id === 'NO_PAYOUT') continue
    const payout = await paypal.getPayout(row.payout_batch_id)
    const success = payout.status === 'SUCCESS'
    const failed = ['DENIED', 'FAILED', 'RETURNED', 'UNCLAIMED', 'BLOCKED'].includes(payout.status)
    if (!success && !failed) {
      results.push({ id: row.id, status: payout.status })
      continue
    }
    const plan = row.plan as { winnerPactIds?: string[]; loserPactIds?: string[] }
    const pactIds = [...new Set([...(plan.winnerPactIds ?? []), ...(plan.loserPactIds ?? [])])]
    if (!success) {
      const { error: transitionError } = await admin.rpc('transition_pacts', {
        p_pact_ids: pactIds,
        p_from: 'SETTLING',
        p_to: 'NEEDS_REVIEW',
      })
      if (transitionError && transitionError.code !== '40001')
        throw new Error('settle pact status failed')
    } else {
      const winners = plan.winnerPactIds ?? []
      const losers = plan.loserPactIds ?? []
      if (winners.length)
        await admin.rpc('transition_pacts', {
          p_pact_ids: winners,
          p_from: 'SETTLING',
          p_to: 'SETTLED_PASS',
        })
      if (losers.length)
        await admin.rpc('transition_pacts', {
          p_pact_ids: losers,
          p_from: 'SETTLING',
          p_to: 'SETTLED_FAIL',
        })
    }
    const { error: updateError } = await admin
      .from('settlements')
      .update({ status: success ? 'COMPLETED' : 'NEEDS_REVIEW' })
      .eq('id', row.id)
      .eq('status', 'EXECUTING')
    if (updateError) throw new Error('update settlement result failed')
    results.push({ id: row.id, status: payout.status })
  }
  return json({ processed: results.length, results })
}
Deno.serve(withCors(handler))
