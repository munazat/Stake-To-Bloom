/**
 * pact-create — turn a wizard selection into a frozen Rule Contract.
 *
 * The client sends *choices* (which template, what threshold, what stake). It
 * never sends a RuleSpec and never sends a hash. The server builds the spec from
 * GOAL_TEMPLATES, normalises it through RuleSpecSchema, hashes the normalised
 * form, and stores both. That ordering is the whole point: the hash the user
 * agrees to on the Rule Contract screen is the hash of the spec the database
 * holds, computed here, so there is no window in which a client could swap one
 * for the other (invariant I9).
 *
 * The row is inserted at AWAITING_STAKE with starts_at/ends_at/funded_at NULL.
 * No money has moved and no day rows exist yet; activation happens when the
 * stake is captured.
 */
import { z } from 'zod'
import {
  GOAL_TEMPLATES,
  PACT_DAYS,
  RuleSpecSchema,
  StakeCentsSchema,
  localDateKey,
  ruleHash,
  type RuleSpec,
} from '../_shared/core/index.ts'
import { requireUserId, serviceClient } from '../_shared/auth.ts'
import { HttpError, assertMethod, json, readJsonBody, withCors } from '../_shared/http.ts'

/**
 * 'custom' is deliberately absent: a custom goal needs the AI to propose checks
 * from free text (rule-draft), so it cannot be created from a template. The
 * wizard shows the tile disabled with that reason rather than sending it here.
 */
const TemplateGoalSchema = z.enum(['steps', 'water', 'meal', 'workout'])

/**
 * Shape only. Numeric ranges for `threshold` and `requiredPasses` are enforced
 * downstream by RuleSpecSchema, which is the single definition shared with the
 * web app and the database CHECK constraints — repeating them here would let the
 * two drift apart.
 */
const RequestSchema = z.object({
  goalType: TemplateGoalSchema,
  threshold: z.number().int().optional(),
  requiredPasses: z.number().int().optional(),
  stakeCents: StakeCentsSchema,
  tz: z.string().min(1).max(64),
  title: z.string().min(1).max(80).optional(),
})

function assertTimeZone(tz: string): string {
  try {
    localDateKey(new Date(), tz)
  } catch {
    throw new HttpError(400, 'invalid_timezone', `"${tz}" is not an IANA timezone name.`)
  }
  return tz
}

function buildSpec(body: z.infer<typeof RequestSchema>): RuleSpec {
  const template = GOAL_TEMPLATES[body.goalType]
  const draft = template({ threshold: body.threshold, requiredPasses: body.requiredPasses })
  const withTitle = body.title ? { ...draft, title: body.title } : draft
  return RuleSpecSchema.parse(withTitle)
}

const handler = async (request: Request): Promise<Response> => {
  assertMethod(request, 'POST')
  const admin = serviceClient()
  const userId = await requireUserId(request, admin)
  const body = RequestSchema.parse(await readJsonBody(request))
  const tz = assertTimeZone(body.tz)

  const spec = buildSpec(body)
  const hash = await ruleHash(spec)
  // Edge Functions are not typechecked in CI, so a dropped `await` above would
  // reach the insert as a Promise and surface only as a constraint violation.
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw new HttpError(500, 'bad_rule_hash', 'Computed rule hash is not 64 lowercase hex chars.')
  }

  const { data: row, error } = await admin
    .from('pacts')
    .insert({
      user_id: userId,
      goal_type: spec.goalType,
      title: spec.title,
      rule_spec: spec,
      rule_hash: hash,
      stake_cents: body.stakeCents,
      currency: 'USD',
      required_passes: spec.requiredPasses,
      days: PACT_DAYS,
      status: 'AWAITING_STAKE',
      tz,
      is_demo: false,
    })
    .select('id, status, title, stake_cents, currency, required_passes, days, tz, created_at')
    .single()

  if (error || !row) {
    console.error('pact insert failed:', error)
    if (error?.code === '23503') {
      throw new HttpError(
        409,
        'profile_missing',
        'Your account profile is missing. Sign in again to recreate it.',
      )
    }
    throw new HttpError(502, 'db_write_failed', 'Could not save the pact. Nothing was charged.')
  }

  return json(
    {
      pact: {
        id: row.id,
        status: row.status,
        title: row.title,
        goalType: spec.goalType,
        stakeCents: Number(row.stake_cents),
        currency: row.currency,
        requiredPasses: row.required_passes,
        days: row.days,
        tz: row.tz,
        createdAt: row.created_at,
        ruleSpec: spec,
        ruleHash: hash,
      },
    },
    201,
  )
}

Deno.serve(withCors(handler))
