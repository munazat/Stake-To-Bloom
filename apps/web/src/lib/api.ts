/**
 * api.ts — the only place the web app calls an Edge Function.
 *
 * Every call attaches the guest session's access token. The function validates it
 * with GoTrue and derives the user id from the token, never from the body, so
 * nothing here can claim to be someone else (invariant I2). The client also never
 * sends a RuleSpec or a hash: it sends choices, and the server builds and hashes
 * the contract (invariant I9).
 */
import type { GoalType, PactStatus, RuleSpec } from '@bloomstake/core'
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

function isPactPayload(payload: unknown): payload is { pact: CreatedPact } {
  return typeof payload === 'object' && payload !== null && 'pact' in payload
}

export async function createPact(input: CreatePactInput): Promise<CreatedPact> {
  const session = await ensureSession()
  const response = await fetch(edgeFunctionUrl('pact-create'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: supabaseAnonKey,
      authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(input),
  })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok || !isPactPayload(payload)) {
    const error =
      payload && typeof payload === 'object' && 'error' in payload
        ? ((payload as { error: ApiErrorBody }).error ?? null)
        : null
    throw new ApiError(response.status, error)
  }
  return payload.pact
}
