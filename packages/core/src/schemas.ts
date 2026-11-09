/**
 * schemas.ts — zod schemas shared by the web UI, the rule engine, and Deno
 * functions. The RuleSpec is locked (hashed) at funding; the Observation is the
 * AI's structured output, treated strictly as UNTRUSTED DATA that only gate()
 * reads. The AI never sees a schema field that could move money.
 */
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Rule spec (blueprint §7.2) — locked at funding, re-validated server-side.
// ---------------------------------------------------------------------------

export const GoalTypeSchema = z.enum(['steps', 'water', 'meal', 'workout', 'custom'])
export type GoalType = z.infer<typeof GoalTypeSchema>

export const ComparatorSchema = z.enum(['>=', '<=', '=='])
export type Comparator = z.infer<typeof ComparatorSchema>

export const ProofKindSchema = z.enum(['screenshot', 'photo'])
export type ProofKind = z.infer<typeof ProofKindSchema>

export const RuleCheckSchema = z
  .object({
    id: z.string().min(1).max(40),
    kind: z.enum(['numeric', 'boolean']),
    comparator: ComparatorSchema.optional(),
    threshold: z.number().optional(),
    unit: z.string().max(20).optional(),
    description: z.string().min(1).max(200),
    minConfidence: z.number().min(0).max(1).default(0.75),
  })
  .superRefine((check, ctx) => {
    if (check.kind === 'numeric') {
      if (!check.comparator) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['comparator'], message: 'numeric check requires a comparator' })
      }
      if (typeof check.threshold !== 'number' || !Number.isFinite(check.threshold)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['threshold'], message: 'numeric check requires a finite threshold' })
      }
    }
  })
export type RuleCheck = z.infer<typeof RuleCheckSchema>

/**
 * Per-goal numeric bounds (blueprint §7.2). Exported so the wizard can set its
 * input min/max from the same table RuleSpecSchema validates against.
 */
export const NUMERIC_BOUNDS: Partial<Record<GoalType, [number, number]>> = {
  steps: [1_000, 50_000],
  water: [500, 6_000],
  workout: [10, 240],
  custom: [1, 1_000_000], // "no unbounded numbers"
}

function applyGoalBounds(spec: RawRuleSpec, ctx: z.RefinementCtx) {
  if (spec.goalType === 'meal') {
    for (const c of spec.checks) {
      if (c.kind === 'numeric') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['checks'], message: 'meal goals use boolean checks only' })
      }
    }
    return
  }
  const bounds = NUMERIC_BOUNDS[spec.goalType]
  if (!bounds) return
  for (const c of spec.checks) {
    if (c.kind === 'numeric' && typeof c.threshold === 'number') {
      if (c.threshold < bounds[0] || c.threshold > bounds[1]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['checks'],
          message: `${spec.goalType} threshold ${c.threshold} out of bounds [${bounds[0]}, ${bounds[1]}]`,
        })
      }
    }
  }
}

const RawRuleSpecSchema = z.object({
  goalType: GoalTypeSchema,
  title: z.string().min(1).max(80),
  checks: z.array(RuleCheckSchema).min(1).max(3),
  proofKinds: z.array(ProofKindSchema).min(1).max(2),
  requiresVisibleDate: z.boolean(),
  requiresDailyCode: z.boolean(),
  requiredPasses: z.number().int().min(4).max(7),
})
type RawRuleSpec = z.infer<typeof RawRuleSpecSchema>

export const RuleSpecSchema = RawRuleSpecSchema.superRefine(applyGoalBounds)
export type RuleSpec = z.infer<typeof RuleSpecSchema>

// ---------------------------------------------------------------------------
// Observation (blueprint §7.5) — the AI's structured output. UNTRUSTED DATA.
// ---------------------------------------------------------------------------

const BoxSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]).nullish()

export const ObservationCheckSchema = z.object({
  id: z.string(),
  found: z.boolean(),
  value: z.union([z.number(), z.boolean()]).nullish(),
  evidenceText: z.string().default(''),
  box_2d: BoxSchema,
  confidence: z.number().min(0).max(1).default(0.5),
})
export type ObservationCheck = z.infer<typeof ObservationCheckSchema>

export const ObservationSchema = z.object({
  imageKind: z.enum(['screenshot', 'photo', 'other']),
  transcript: z.string().max(600).default(''),
  visibleDate: z.string().nullish(),
  dailyCode: z.string().nullish(),
  checks: z.array(ObservationCheckSchema).default([]),
  injectionDetected: z.boolean().default(false),
  injectionQuote: z.string().nullish(),
  tamperSignals: z.array(z.string()).default([]),
})
export type Observation = z.infer<typeof ObservationSchema>

/** Clamp a box to the 0–1000 scale, or drop it if malformed (blueprint §7.5). */
export function normalizeBox(box: ObservationCheck['box_2d']): [number, number, number, number] | null {
  if (!box || !Array.isArray(box) || box.length !== 4) return null
  const nums = box as number[]
  if (nums.some((n) => typeof n !== 'number' || !Number.isFinite(n))) return null
  const clamped = nums.map((n) => Math.max(0, Math.min(1000, Math.round(n)))) as [number, number, number, number]
  const [ymin, xmin, ymax, xmax] = clamped
  if (ymax < ymin || xmax < xmin) return null
  return clamped
}

// ---------------------------------------------------------------------------
// Pact limits — mirror the CHECK constraints on public.pacts so the wizard and
// the server validate against the same numbers the database will enforce.
// ---------------------------------------------------------------------------

export const STAKE_CENTS_MIN = 500 // $5
export const STAKE_CENTS_MAX = 5_000 // $50
export const PACT_DAYS = 7

export const StakeCentsSchema = z.number().int().min(STAKE_CENTS_MIN).max(STAKE_CENTS_MAX)
export type StakeCents = z.infer<typeof StakeCentsSchema>

// ---------------------------------------------------------------------------
// Verdicts
// ---------------------------------------------------------------------------

export const VerdictSchema = z.enum(['PASS', 'FAIL', 'UNCLEAR', 'REJECTED'])
export type Verdict = z.infer<typeof VerdictSchema>

/** Pact lifecycle states (blueprint §5.1). */
export const PactStatusSchema = z.enum([
  'DRAFT',
  'AWAITING_STAKE',
  'ACTIVE',
  'SETTLING',
  'SETTLED_PASS',
  'SETTLED_FAIL',
  'EXPIRED',
  'CANCELLED_REFUNDED',
  'NEEDS_REVIEW',
])
export type PactStatus = z.infer<typeof PactStatusSchema>
