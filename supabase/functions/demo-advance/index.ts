import { z } from 'zod'
import { requireUserId, serviceClient } from '../_shared/auth.ts'
import { assertMethod, HttpError, json, readJsonBody, withCors } from '../_shared/http.ts'
import { enforceCounter, requestIp } from '../_shared/rateLimit.ts'
import { canonicalJson, settle, sha256Hex } from '../_shared/core/index.ts'

const Body = z.object({ pool_id: z.string().uuid() })
const handler = async (request: Request) => {
  assertMethod(request, 'POST')
  const admin = serviceClient()
  const userId = await requireUserId(request, admin)
  const { pool_id: poolId } = Body.parse(await readJsonBody(request))
  await enforceCounter(admin, { scope: 'USER', value: userId, limit: 20 })
  await enforceCounter(admin, { scope: 'IP', value: requestIp(request), limit: 30 })

  const { data: owner, error: ownerError } = await admin
    .from('pacts')
    .select('id,demo_role,is_demo,pool_id')
    .eq('pool_id', poolId)
    .eq('user_id', userId)
    .eq('demo_role', 'OWNER')
    .maybeSingle()
  if (ownerError || !owner)
    throw new HttpError(404, 'demo_not_found', 'Demo pool not found for this account.')
  if (!owner.is_demo || owner.pool_id !== poolId)
    throw new HttpError(403, 'not_demo', 'Fast-forward is only available in a demo pool.')
  const { data: pool, error: poolError } = await admin
    .from('pools')
    .select('is_demo,demo_advanced_days,status')
    .eq('id', poolId)
    .maybeSingle()
  if (poolError || !pool?.is_demo || pool.status !== 'ACTIVE')
    throw new HttpError(403, 'not_demo', 'Fast-forward is only available in an active demo pool.')
  if (pool.demo_advanced_days === 0) {
    const { data: ownerDay, error } = await admin
      .from('pact_days')
      .select('status')
      .eq('pact_id', owner.id)
      .eq('day_index', 0)
      .maybeSingle()
    if (error) throw new Error('read demo day failed')
    if (ownerDay?.status !== 'PASSED')
      throw new HttpError(
        409,
        'real_proof_required',
        'Submit and pass your real proof for today before fast-forwarding the demo.',
      )
  }
  const { data: advanced, error } = await admin.rpc('advance_demo_day', { p_pool_id: poolId })
  if (error) throw new HttpError(409, 'demo_advance_failed', 'The demo day could not be advanced.')
  let settled = false
  if (Number(advanced) >= 7) {
    const existing = await admin
      .from('settlements')
      .select('id')
      .eq('pool_id', poolId)
      .maybeSingle()
    if (existing.error) throw new Error('check demo settlement failed')
    if (!existing.data) {
      const { data: rows, error: pactError } = await admin
        .from('pacts')
        .select('id,user_id,is_simulated,stake_cents,required_passes,payer_email,pact_days(status)')
        .eq('pool_id', poolId)
      if (pactError || !rows?.length || rows.some((row: any) => !row.is_simulated))
        throw new HttpError(
          409,
          'demo_pool_invalid',
          'The demo pool contains a real stake and cannot use simulated settlement.',
        )
      const result = settle({
        poolIsDemo: true,
        charityEmail: null,
        members: rows.map((row: any) => ({
          pactId: row.id,
          userId: row.user_id,
          isSim: true,
          stakeCents: Number(row.stake_cents),
          passes: (row.pact_days ?? []).filter((d: any) => d.status === 'PASSED').length,
          requiredPasses: row.required_passes,
          payerEmail: row.payer_email,
        })),
      })
      const hash = await sha256Hex(canonicalJson(result))
      const { error: claimError } = await admin.rpc('transition_pacts', {
        p_pact_ids: rows.map((r: any) => r.id),
        p_from: 'ACTIVE',
        p_to: 'SETTLING',
      })
      if (claimError)
        throw new HttpError(
          409,
          'demo_settlement_race',
          'The demo settlement is already being processed.',
        )
      const saved = await admin.from('settlements').insert({
        pool_id: poolId,
        plan: result,
        plan_hash: hash,
        sender_batch_id: `bloom-demo-${poolId}`,
        payout_batch_id: 'NO_PAYOUT',
        status: 'COMPLETED',
      })
      if (saved.error) throw new Error('save demo settlement failed')
      for (const [ids, to] of [
        [result.winnerPactIds, 'SETTLED_PASS'],
        [result.loserPactIds, 'SETTLED_FAIL'],
      ] as const) {
        if (!ids.length) continue
        const { error } = await admin.rpc('transition_pacts', {
          p_pact_ids: ids,
          p_from: 'SETTLING',
          p_to: to,
        })
        if (error) throw new Error('complete demo settlement failed')
      }
      settled = true
    }
  }
  return json({
    advancedDay: advanced,
    simulated: true,
    settled,
    message: 'Demo day simulated; no AI call or money movement.',
  })
}
Deno.serve(withCors(handler))
