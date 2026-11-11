/**
 * pact-confirm — the user locks the contract they were shown.
 *
 * The only path from DRAFT to AWAITING_STAKE. It reads nothing but the pact id;
 * the rule, hash and stake are whatever the DRAFT row already holds, so what the
 * user confirms is exactly what rule-draft stored and showed (invariant I9).
 */
import { z } from 'zod'
import { RuleSpecSchema } from '../_shared/core/index.ts'
import { requireUserId, serviceClient } from '../_shared/auth.ts'
import { HttpError, assertMethod, json, readJsonBody, withCors } from '../_shared/http.ts'

const RequestSchema = z.object({ pact_id: z.string().uuid() })

const handler = async (request: Request): Promise<Response> => {
  assertMethod(request, 'POST')
  const admin = serviceClient()
  const userId = await requireUserId(request, admin)
  const { pact_id } = RequestSchema.parse(await readJsonBody(request))

  const { data: pact, error } = await admin
    .from('pacts')
    .select('id, user_id, status, title, goal_type, stake_cents, currency, required_passes, days, tz, created_at, rule_spec, rule_hash')
    .eq('id', pact_id)
    .maybeSingle()
  if (error) throw new Error('load pact failed')
  if (!pact || pact.user_id !== userId) throw new HttpError(404, 'pact_not_found', 'No such pact for this account.')
  if (pact.status !== 'DRAFT') {
    throw new HttpError(409, 'not_a_draft', 'Only an unconfirmed draft can be confirmed.')
  }

  const { error: moveError } = await admin.rpc('transition_pact', {
    p_pact_id: pact_id,
    p_from: 'DRAFT',
    p_to: 'AWAITING_STAKE',
  })
  if (moveError) {
    if (moveError.code === '40001') throw new HttpError(409, 'already_confirmed', 'This pact was already confirmed.')
    throw new Error('transition failed')
  }

  return json({
    pact: {
      id: pact.id,
      status: 'AWAITING_STAKE',
      title: pact.title,
      goalType: pact.goal_type,
      stakeCents: Number(pact.stake_cents),
      currency: pact.currency,
      requiredPasses: pact.required_passes,
      days: pact.days,
      tz: pact.tz,
      createdAt: pact.created_at,
      ruleSpec: RuleSpecSchema.parse(pact.rule_spec),
      ruleHash: pact.rule_hash,
    },
  })
}

Deno.serve(withCors(handler))
