/**
 * rule-draft — the AI proposes a custom goal; nothing binds until the user confirms.
 *
 * Body: { description, stakeCents, requiredPasses, tz }. The model's proposal is
 * rebuilt into a RuleSpec by code (core/ruledraft.ts), validated, hashed here, and
 * stored as a DRAFT pact. It becomes payable only when the user confirms that exact
 * contract through pact-confirm, which is the only path DRAFT -> AWAITING_STAKE.
 * The client never sends a spec or a hash, and the model never sees the stake.
 */
import { z } from 'zod'
import {
  DESCRIPTION_MAX,
  DESCRIPTION_MIN,
  PACT_DAYS,
  StakeCentsSchema,
  localDateKey,
  ruleHash,
} from '../_shared/core/index.ts'
import { requireUserId, serviceClient } from '../_shared/auth.ts'
import { textDepsFromEnv } from '../_shared/gemini.ts'
import { HttpError, assertMethod, json, readJsonBody, withCors } from '../_shared/http.ts'
import { enforceCounter, requestIp } from '../_shared/rateLimit.ts'
import { draftRuleSpec } from './draft.ts'

const MAX_OPEN_DRAFTS = 5

const RequestSchema = z.object({
  description: z.string().trim().min(DESCRIPTION_MIN).max(DESCRIPTION_MAX),
  stakeCents: StakeCentsSchema,
  requiredPasses: z.number().int().min(4).max(7),
  tz: z.string().min(1).max(64),
})

function intEnv(name: string, fallback: number): number {
  const n = Number(Deno.env.get(name))
  return Number.isInteger(n) && n > 0 ? n : fallback
}

const handler = async (request: Request): Promise<Response> => {
  assertMethod(request, 'POST')
  const admin = serviceClient()
  const userId = await requireUserId(request, admin)
  await enforceCounter(admin, { scope: 'USER', value: userId, limit: 5 })
  await enforceCounter(admin, { scope: 'IP', value: requestIp(request), limit: 60 })
  const body = RequestSchema.parse(await readJsonBody(request))
  try {
    localDateKey(new Date(), body.tz)
  } catch {
    throw new HttpError(400, 'invalid_timezone', `"${body.tz}" is not an IANA timezone name.`)
  }

  const { data: cfg } = await admin
    .from('app_config')
    .select('value')
    .eq('key', 'ai_enabled')
    .maybeSingle()
  if (cfg?.value !== true) {
    throw new HttpError(
      503,
      'ai_unavailable',
      'AI drafting is paused right now. Pick one of the template goals.',
    )
  }

  const { count: openDrafts } = await admin
    .from('pacts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'DRAFT')
  if ((openDrafts ?? 0) >= MAX_OPEN_DRAFTS) {
    throw new HttpError(
      429,
      'too_many_drafts',
      'You have several unconfirmed drafts. Lock or abandon one first.',
    )
  }

  const { data: usage, error: usageError } = await admin.rpc('bump_ai_usage_pair', {
    p_user_id: userId,
  })
  if (usageError) throw new Error('usage bump failed')
  const row = Array.isArray(usage) ? usage[0] : usage
  if (
    Number(row?.user_count ?? Infinity) > intEnv('AI_DAILY_CAP_USER', 8) ||
    Number(row?.global_count ?? Infinity) > intEnv('AI_DAILY_CAP_GLOBAL', 300)
  ) {
    throw new HttpError(
      429,
      'ai_cap_reached',
      "Today's AI allowance is used up. Try a template goal, or come back tomorrow.",
    )
  }

  const drafted = await draftRuleSpec(body.description, body.requiredPasses, textDepsFromEnv())
  if (drafted.kind === 'unavailable') {
    throw new HttpError(
      503,
      'ai_unavailable',
      'The AI drafter is unavailable right now. Pick one of the template goals.',
    )
  }
  if (drafted.kind === 'not_verifiable') {
    throw new HttpError(
      422,
      'not_verifiable',
      'That habit cannot be proven with one photo or screenshot a day. Try describing something visible, like a number on a tracker or a photo.',
    )
  }

  const { spec } = drafted
  const hash = await ruleHash(spec)
  if (!/^[0-9a-f]{64}$/.test(hash))
    throw new HttpError(500, 'bad_rule_hash', 'Computed rule hash is malformed.')

  const { data: pact, error } = await admin
    .from('pacts')
    .insert({
      user_id: userId,
      goal_type: 'custom',
      title: spec.title,
      rule_spec: spec,
      rule_hash: hash,
      stake_cents: body.stakeCents,
      currency: 'USD',
      required_passes: spec.requiredPasses,
      days: PACT_DAYS,
      status: 'DRAFT',
      tz: body.tz,
      is_demo: false,
    })
    .select('id, status, title, stake_cents, currency, required_passes, days, tz, created_at')
    .single()
  if (error || !pact) {
    console.error('draft insert failed:', error?.code)
    throw new HttpError(502, 'db_write_failed', 'Could not save the draft. Nothing was charged.')
  }

  return json(
    {
      draft: {
        id: pact.id,
        status: pact.status,
        title: pact.title,
        goalType: 'custom',
        stakeCents: Number(pact.stake_cents),
        currency: pact.currency,
        requiredPasses: pact.required_passes,
        days: pact.days,
        tz: pact.tz,
        createdAt: pact.created_at,
        ruleSpec: spec,
        ruleHash: hash,
      },
    },
    201,
  )
}

Deno.serve(withCors(handler))
