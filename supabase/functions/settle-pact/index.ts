import { z } from 'zod'
import { requireUserId, serviceClient } from '../_shared/auth.ts'
import { assertMethod, json, readJsonBody, secretMatches, withCors, HttpError } from '../_shared/http.ts'
import { assertPaymentsEnabled, paypalClientFromEnv } from '../_shared/paypal.ts'
import { ruleHash } from '../_shared/core/index.ts'
import { settlePact } from './flow.ts'

const paypal = paypalClientFromEnv()
const Body = z.object({ pact_id: z.string().uuid() })
const handler = async (request: Request) => {
  assertMethod(request, 'POST')
  const admin = serviceClient()
  const cronSecret = Deno.env.get('CRON_SECRET')
  const adminSecret = Deno.env.get('ADMIN_SECRET')
  const auth = request.headers.get('authorization') ?? ''
  const caller =
    cronSecret && secretMatches(auth, `Bearer ${cronSecret}`)
      ? 'cron'
      : adminSecret && secretMatches(auth, `Bearer ${adminSecret}`)
        ? 'admin'
        : null
  const userId = caller ? null : await requireUserId(request, admin)
  const { pact_id: id } = Body.parse(await readJsonBody(request))
  await assertPaymentsEnabled(admin)
  const config = await admin
    .from('app_config')
    .select('value')
    .eq('key', 'settlement_enabled')
    .maybeSingle()
  if (config.error || config.data?.value !== true)
    throw new HttpError(503, 'settlement_disabled', 'Settlement is switched off.')
  const pact = await admin
    .from('pacts')
    .select('id,user_id,status,pool_id,is_demo')
    .eq('id', id)
    .maybeSingle()
  if (pact.error || !pact.data) throw new HttpError(404, 'pact_not_found', 'Pact not found.')
  const pactRow = pact.data
  if (userId && pactRow.user_id !== userId)
    throw new HttpError(403, 'forbidden', 'This pact belongs to another account.')
  if (userId && !pactRow.is_demo)
    throw new HttpError(403, 'forbidden', 'Only operations can settle a non-demo pact.')
  const membersQuery = admin
    .from('pacts')
    .select(
      'id,user_id,is_demo,stake_cents,required_passes,payer_email,rule_hash,rule_spec,status,pact_days(status)',
    )
    .eq(pactRow.pool_id ? 'pool_id' : 'id', pactRow.pool_id ?? id)
  const { data: rows, error } = await membersQuery
  if (error || !rows?.length) throw new Error('load settlement members failed')
  const memberIds = rows.map((r: any) => r.id)
  const passCounts = new Map<string, number>(
    rows.map((r: any) => [
      r.id,
      (r.pact_days ?? []).filter((d: any) => d.status === 'PASSED').length,
    ]),
  )
  const charity = Deno.env.get('PAYPAL_CHARITY_EMAIL') ?? null
  const existing = await admin
    .from('settlements')
    .select('id,plan_hash,sender_batch_id,payout_batch_id,status')
    .eq(pactRow.pool_id ? 'pool_id' : 'pact_id', pactRow.pool_id ?? id)
    .maybeSingle()
  if (existing.error) throw new Error('check prior settlement failed')
  const ledger = await admin
    .from('ledger_entries')
    .select('pact_id,amount_cents,kind')
    .in('pact_id', memberIds)
    .in('kind', ['STAKE_IN', 'SIM_STAKE'])
  if (ledger.error) throw new Error('load settlement ledger failed')
  const pool = pactRow.pool_id
    ? await admin.from('pools').select('is_demo').eq('id', pactRow.pool_id).maybeSingle()
    : null
  if (pool?.error) throw new Error('load settlement pool failed')
  const isDemo = pool?.data?.is_demo === true || (!pactRow.pool_id && pactRow.is_demo === true)
  const simulatedIds = new Set(
    (ledger.data ?? []).filter((r: any) => r.kind === 'SIM_STAKE').map((r: any) => r.pact_id),
  )
  const ledgerRowsByPact = new Map<string, any[]>(
    memberIds.map((memberId: string) => [memberId, []]),
  )
  for (const entry of ledger.data ?? []) ledgerRowsByPact.get(entry.pact_id)?.push(entry)
  const simulatedForfeitCents = rows.reduce((sum: number, row: any) => {
    const isSim = simulatedIds.has(row.id)
    const passes = passCounts.get(row.id) ?? 0
    if (isSim && passes < row.required_passes) {
      return (
        sum +
        (ledgerRowsByPact.get(row.id) ?? [])
          .filter((entry: any) => entry.kind === 'SIM_STAKE')
          .reduce((n: number, entry: any) => n + Number(entry.amount_cents), 0)
      )
    }
    return sum
  }, 0)
  const computedRules = await Promise.all(
    rows.map((r: any) => ruleHash(r.rule_spec).then((h) => h === r.rule_hash)),
  )
  const retry =
    pactRow.status === 'NEEDS_REVIEW' && existing.data
      ? {
          planHash: existing.data.plan_hash,
          batchId: existing.data.sender_batch_id ?? `bloom-settle-${id}`,
          payoutSubmitted: Boolean(existing.data.payout_batch_id),
        }
      : null
  if (retry?.payoutSubmitted)
    throw new HttpError(
      409,
      'payout_needs_review',
      'A payout was already submitted; review its status before retrying.',
    )
  const guard = {
    settlementEnabled: true,
    paymentsEnabled: true,
    sandbox: paypal.kind === 'mock' || Deno.env.get('PAYPAL_ENV') === 'sandbox',
    expectedRecipients: Object.fromEntries(rows.map((r: any) => [r.id, r.payer_email])),
    charityEmail: charity,
    ledgerStakeCents: (ledger.data ?? [])
      .filter((r: any) => r.kind === 'STAKE_IN')
      .reduce((n: number, r: any) => n + Number(r.amount_cents), 0),
    simulatedForfeitCents,
    isDemo,
    ruleHashesMatch: computedRules.every(Boolean),
    closedDayCount: rows.reduce(
      (n: number, r: any) =>
        n + (r.pact_days ?? []).filter((d: any) => d.status !== 'PENDING').length,
      0,
    ),
    status: 'SETTLING',
    hasEarlierPayout: Boolean(existing.data?.payout_batch_id),
    requiredDayCount: rows.length * 7,
    caller: (caller ?? 'owner') as 'cron' | 'admin' | 'owner',
    demoOwner: Boolean(userId && isDemo),
  }
  const result = await settlePact(
    {
      paypal,
      async transition(pactIds, from, to) {
        const { error } = await admin.rpc('transition_pacts', {
          p_pact_ids: pactIds,
          p_from: from,
          p_to: to,
        })
        return !error
      },
      async load() {
        return {
          status: pactRow.status,
          settlementEnabled: true,
          paymentsEnabled: true,
          payoutExists: Boolean(existing.data?.payout_batch_id),
          retry,
          input: {
            members: rows.map((r: any) => ({
              pactId: r.id,
              userId: r.user_id,
              isSim: simulatedIds.has(r.id),
              stakeCents: Number(r.stake_cents),
              passes: passCounts.get(r.id) ?? 0,
              requiredPasses: r.required_passes,
              payerEmail: r.payer_email,
            })),
            charityEmail: charity,
            poolIsDemo: isDemo,
          },
          guard,
        }
      },
      async savePlan(pactId, plan, hash, batchId) {
        const { error } = retry
          ? await admin
              .from('settlements')
              .update({ status: 'PLANNED' })
              .eq('id', existing.data!.id)
          : await admin.from('settlements').insert({
              pact_id: pactRow.pool_id ? null : pactId,
              pool_id: pactRow.pool_id,
              plan,
              plan_hash: hash,
              sender_batch_id: batchId,
              status: 'PLANNED',
            })
        if (error) throw new Error('save settlement plan failed')
      },
      async markReview(_id, hash) {
        if (hash)
          await admin
            .from('settlements')
            .update({ status: 'NEEDS_REVIEW' })
            .eq('plan_hash', hash)
            .eq('sender_batch_id', `bloom-settle-${_id}`)
      },
      async completeNoPayout(pactId, plan, hash, batchId) {
        const { error } = await admin
          .from('settlements')
          .update({ status: 'COMPLETED', sender_batch_id: batchId, payout_batch_id: 'NO_PAYOUT' })
          .eq('sender_batch_id', batchId)
        if (error) throw new Error('complete no-money settlement failed')
        const winner = plan.winnerPactIds.includes(pactId)
        const pactIds = [...plan.winnerPactIds, ...plan.loserPactIds]
        const { error: transitionError } = await admin.rpc('transition_pacts', {
          p_pact_ids: pactIds.length ? pactIds : [pactId],
          p_from: 'SETTLING',
          p_to: winner ? 'SETTLED_PASS' : 'SETTLED_FAIL',
        })
        if (transitionError) throw new Error('finalize no-money pact failed')
      },
      async markSubmitted(_id, hash, batchId, payoutId) {
        const settlement = await admin
          .from('settlements')
          .select('id,plan')
          .eq('sender_batch_id', batchId)
          .maybeSingle()
        if (settlement.error || !settlement.data) throw new Error('load settlement plan failed')
        const plan = settlement.data.plan as {
          items?: Array<{ pactId: string; amountCents: number }>
          charityCents?: number
        }
        const entries = (plan.items ?? []).map((item, n) => ({
          pact_id: item.pactId,
          kind: 'PAYOUT_OUT',
          amount_cents: item.amountCents,
          ref: `${payoutId}:bloom-${id}-${n}`,
        }))
        if ((plan.charityCents ?? 0) > 0)
          entries.push({
            pact_id: id,
            kind: 'CHARITY_OUT',
            amount_cents: plan.charityCents!,
            ref: `${payoutId}:bloom-${id}-charity`,
          })
        if (entries.length) {
          const written = await admin
            .from('ledger_entries')
            .upsert(entries, { onConflict: 'kind,ref', ignoreDuplicates: true })
          if (written.error) throw new Error('write payout ledger failed')
        }
        const { error } = await admin
          .from('settlements')
          .update({ status: 'EXECUTING', sender_batch_id: batchId, payout_batch_id: payoutId })
          .eq('sender_batch_id', batchId)
        if (error) throw new Error('save payout batch failed')
        const amountCents = (plan.items ?? []).reduce(
          (sum, item) => sum + item.amountCents,
          plan.charityCents ?? 0,
        )
        const audit = await admin.from('paypal_events').insert({
          source: 'API',
          event_type: 'PAYOUTS.CREATE',
          resource_id: payoutId,
          pact_id: pactRow.pool_id ? null : _id,
          status: 'SUBMITTED',
          amount_cents: amountCents,
          verified: false,
          public_payload: { sender_batch_id: batchId },
        })
        if (audit.error) throw new Error('record payout audit event failed')
      },
    },
    id,
    caller ?? 'owner',
  )
  return json(result)
}
Deno.serve(withCors(handler))
