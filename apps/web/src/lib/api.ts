/**
 * api.ts — the only place the web app calls an Edge Function.
 *
 * Every call attaches the guest session's access token. The function validates it
 * with GoTrue and derives the user id from the token, never from the body, so
 * nothing here can claim to be someone else (invariant I2). The client also never
 * sends a RuleSpec or a hash: it sends choices, and the server builds and hashes
 * the contract (invariant I9).
 */
import type { GoalType, PactStatus, RuleSpec, Verdict } from '@bloomstake/core'
import { ensureSession } from './session.ts'
import { edgeFunctionUrl, supabaseAnonKey } from './config.ts'

/** Goals that can be created from a template. 'custom' needs the AI drafter. */
export type TemplateGoal = Exclude<GoalType, 'custom'>

export interface CreatePactInput {
  goalType: TemplateGoal
  threshold?: number
  requiredPasses?: number
  stakeCents: number
  tz: string
  title?: string
}

export interface CreatedPact {
  id: string
  status: PactStatus
  title: string
  goalType: GoalType
  stakeCents: number
  currency: string
  requiredPasses: number
  days: number
  tz: string
  createdAt: string
  ruleSpec: RuleSpec
  ruleHash: string
}

export interface ApiErrorBody {
  code: string
  message: string
  details?: unknown
}

export class ApiError extends Error {
  readonly status: number
  readonly body: ApiErrorBody | null

  constructor(status: number, body: ApiErrorBody | null) {
    super(body?.message ?? `Request failed with status ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

/** The IANA zone the browser is set to; this is what "which day is it?" uses. */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

/** POST to an Edge Function with the guest token; throws ApiError on any failure. */
async function post(name: string, body: unknown): Promise<unknown> {
  const session = await ensureSession()
  const response = await fetch(edgeFunctionUrl(name), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: supabaseAnonKey,
      authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const error =
      payload && typeof payload === 'object' && 'error' in payload
        ? ((payload as { error: ApiErrorBody }).error ?? null)
        : null
    throw new ApiError(response.status, error)
  }
  return payload
}

function isPactPayload(payload: unknown): payload is { pact: CreatedPact } {
  return typeof payload === 'object' && payload !== null && 'pact' in payload
}

export async function createPact(input: CreatePactInput): Promise<CreatedPact> {
  const payload = await post('pact-create', input)
  if (!isPactPayload(payload))
    throw new ApiError(502, { code: 'bad_response', message: 'Unexpected server response.' })
  return payload.pact
}

export interface DraftRuleInput {
  description: string
  stakeCents: number
  requiredPasses: number
  tz: string
}

/**
 * Ask the AI to propose a custom rule. The result is a DRAFT: the server built
 * and hashed the spec, and nothing is payable until confirmPact().
 */
export async function draftRule(input: DraftRuleInput): Promise<CreatedPact> {
  const payload = await post('rule-draft', input)
  const draft = (payload as { draft?: CreatedPact } | null)?.draft
  if (!draft)
    throw new ApiError(502, { code: 'bad_response', message: 'Unexpected server response.' })
  return draft
}

/** Lock the exact drafted contract (DRAFT -> AWAITING_STAKE). Sends only the pact id. */
export async function confirmPact(pactId: string): Promise<CreatedPact> {
  const payload = await post('pact-confirm', { pact_id: pactId })
  if (!isPactPayload(payload))
    throw new ApiError(502, { code: 'bad_response', message: 'Unexpected server response.' })
  return payload.pact
}

/** Cancel an ACTIVE pact before day one; the server validates eligibility and refunds the capture. */
export async function refundPact(pactId: string): Promise<void> {
  await post('refund-pact', { pact_id: pactId })
}

export interface DemoBootstrapResult {
  demo: true
  pactId: string
  poolId: string
  existing?: boolean
}

export async function startDemo(): Promise<DemoBootstrapResult> {
  const payload = await post('demo-bootstrap', {})
  if (!payload || typeof payload !== 'object' || !('pactId' in payload) || !('poolId' in payload))
    throw new ApiError(502, { code: 'bad_response', message: 'Unexpected demo response.' })
  return payload as DemoBootstrapResult
}

export async function advanceDemo(
  poolId: string,
): Promise<{ advancedDay: number; simulated: true }> {
  const payload = await post('demo-advance', { pool_id: poolId })
  if (!payload || typeof payload !== 'object' || !('advancedDay' in payload))
    throw new ApiError(502, { code: 'bad_response', message: 'Unexpected demo response.' })
  return payload as { advancedDay: number; simulated: true }
}

// ---------------------------------------------------------------------------
// Proofs
// ---------------------------------------------------------------------------

export interface ProofEvidence {
  id: string
  description: string
  found: boolean
  value: number | boolean | null
  evidenceText: string
  /** [ymin, xmin, ymax, xmax] on a 0-1000 scale, or null. */
  box: [number, number, number, number] | null
}

/** What submit-proof returns. Every string here is AI- or server-written: render as text only. */
export interface ProofResult {
  outcome: 'judged' | 'queued' | 'duplicate' | 'already_verified'
  proofId: string | null
  dayIndex: number
  attemptNo: number | null
  attemptsLeft: number
  verdict: Verdict | null
  reasons: string[]
  injectionFlag: boolean
  evidence: ProofEvidence[]
  model: string | null
  cached: boolean
  vitality: number | null
}

/**
 * The client names the pact and the file it uploaded. The server decides the day
 * (from its own clock), the verdict, and the user — none of those are sent.
 */
export async function submitProof(pactId: string, storagePath: string): Promise<ProofResult> {
  const payload = await post('submit-proof', { pact_id: pactId, storage_path: storagePath })
  const proof = (payload as { proof?: ProofResult } | null)?.proof
  if (!proof)
    throw new ApiError(502, { code: 'bad_response', message: 'Unexpected server response.' })
  return proof
}

// ---------------------------------------------------------------------------
// Payments (stake in)
// ---------------------------------------------------------------------------

/**
 * Ask the server for the PayPal order that funds this pact. The amount is the
 * server's, read from the pact row; the browser sends only the pact id (I2).
 */
export async function createStakeOrder(pactId: string): Promise<string> {
  const payload = await post('paypal-create-order', { pact_id: pactId })
  const id = (payload as { order_id?: unknown } | null)?.order_id
  if (typeof id !== 'string' || id === '')
    throw new ApiError(502, { code: 'bad_response', message: 'Unexpected server response.' })
  return id
}

export interface CaptureOutcome {
  status: 'ACTIVE' | 'AWAITING_STAKE'
  funded: boolean
  pending?: boolean
}

/**
 * "capture" settles an approved order; "check" only reads it, so the pact page can
 * heal a stake whose capture succeeded but whose confirmation was lost.
 */
export async function captureStakeOrder(
  orderId: string,
  mode: 'capture' | 'check' = 'capture',
): Promise<CaptureOutcome> {
  const payload = await post('paypal-capture-order', { order_id: orderId, mode })
  const out = payload as CaptureOutcome | null
  if (!out || typeof out.funded !== 'boolean')
    throw new ApiError(502, { code: 'bad_response', message: 'Unexpected server response.' })
  return out
}
