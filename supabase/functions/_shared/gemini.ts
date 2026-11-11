/**
 * gemini.ts — the only place the vision model is called.
 *
 * What this module promises its caller:
 *   - It never throws for a model problem. Bad key, retired model, 429 storm,
 *     timeout, safety block, malformed JSON: every one of them comes back as
 *     `observation: null`, which the caller records as UNCLEAR (invariant I8 —
 *     a technical failure never costs the user money).
 *   - It returns DATA. The model has no tools and no function calling; what it
 *     says is parsed into an Observation and handed to gate(), which alone
 *     decides (invariant I1).
 *   - It reports which model answered, for `proofs.ai_model`.
 *
 * Retry policy (blueprint §7.3): models are tried in GEMINI_MODEL_CHAIN order,
 * best first. Each model gets up to two tries. A 429 honours the server's
 * `retryDelay` when it fits the budget, otherwise backs off 1 s then 3 s. A
 * request the model can never satisfy (400/401/403/404) skips straight to the
 * next model. Malformed output gets exactly one retry overall, then UNCLEAR.
 * An overall deadline keeps the whole thing inside the Edge Function wall clock.
 *
 * The SDK's own retry layer is left off (no `retryOptions`), so this file is the
 * only retry policy — two stacked policies multiply calls against a free quota.
 */
import { ApiError, GoogleGenAI } from '@google/genai'
import {
  GENERATION_SETTINGS,
  OBSERVATION_RESPONSE_SCHEMA,
  SYSTEM_INSTRUCTION,
  buildExtractionPrompt,
  observationFromModel,
  thinkingConfigFor,
  type Observation,
  type RuleSpec,
} from './core/index.ts'

export const REQUEST_TIMEOUT_MS = 25_000
export const TRIES_PER_MODEL = 2
export const BACKOFF_MS = [1_000, 3_000] as const
/** Stop starting new attempts after this long; keeps us inside the wall clock. */
export const OVERALL_BUDGET_MS = 75_000
/** Never sleep longer than this for a server-suggested retryDelay. */
export const MAX_SERVER_DELAY_MS = 10_000
const MAX_RAW_CHARS = 8_000

export interface ExtractInput {
  imageBase64: string
  mimeType: 'image/jpeg' | 'image/png'
  spec: RuleSpec
}

/** What one generateContent call produced, normalised away from the SDK. */
export interface GenerateOutcome {
  text: string | null
  blockReason: string | null
  candidateCount: number
}

export type GenerateFn = (model: string, input: ExtractInput) => Promise<GenerateOutcome>

export interface AttemptLog {
  model: string
  try: number
  result: 'ok' | 'invalid_output' | 'blocked' | 'rate_limited' | 'unavailable' | 'rejected_request' | 'error'
  status?: number
}

export interface ExtractResult {
  observation: Observation | null
  /** The model's parsed JSON (or a truncated string if it was not JSON). Stored as ai_raw. */
  raw: unknown
  /** The model that produced `observation`, or null when none did. */
  model: string | null
  outcome: 'ok' | 'invalid_output' | 'blocked' | 'unavailable' | 'not_configured'
  attempts: AttemptLog[]
}

export interface ExtractDeps {
  models: string[]
  generate: GenerateFn
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

const MODEL_NAME = /^[a-z0-9][a-z0-9.\-]{1,62}$/i

/** Parse GEMINI_MODEL_CHAIN: comma-separated, best first, de-duplicated. */
export function parseModelChain(raw: string | undefined | null): string[] {
  if (!raw) return []
  const seen = new Set<string>()
  for (const part of raw.split(',')) {
    const name = part.trim().replace(/^models\//, '')
    if (MODEL_NAME.test(name)) seen.add(name)
  }
  return [...seen].slice(0, 6)
}

/** Seconds from a google.rpc.RetryInfo `retryDelay` buried in an error message. */
export function retryDelayMs(message: string): number | null {
  const m = /retryDelay\\?"\s*:\s*\\?"(\d+(?:\.\d+)?)s/.exec(message)
  return m ? Math.round(Number(m[1]) * 1000) : null
}

type Classified = { kind: 'rate_limited'; delayMs: number | null } | { kind: 'retryable' } | { kind: 'skip_model' }

function classify(err: unknown): { c: Classified; status?: number } {
  if (err instanceof ApiError || (err && typeof err === 'object' && 'status' in err && typeof (err as { status: unknown }).status === 'number')) {
    const status = (err as { status: number }).status
    const message = err instanceof Error ? err.message : ''
    if (status === 429) return { c: { kind: 'rate_limited', delayMs: retryDelayMs(message) }, status }
    if (status >= 500) return { c: { kind: 'retryable' }, status }
    // 400 bad schema/config for this model, 401/403 key, 404 retired model:
    // trying the same request again cannot help.
    return { c: { kind: 'skip_model' }, status }
  }
  // Timeouts, aborts, DNS, connection resets.
  return { c: { kind: 'retryable' } }
}

function truncateRaw(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text.slice(0, MAX_RAW_CHARS)
  }
}

/**
 * Ask the chain for an Observation. Never throws for model-side problems.
 */
export async function extractObservation(input: ExtractInput, deps: ExtractDeps): Promise<ExtractResult> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const now = deps.now ?? Date.now
  const attempts: AttemptLog[] = []
  if (deps.models.length === 0) {
    return { observation: null, raw: null, model: null, outcome: 'not_configured', attempts }
  }

  const started = now()
  const overBudget = () => now() - started >= OVERALL_BUDGET_MS
  let invalidOutputs = 0
  let lastRaw: unknown = null

  for (const model of deps.models) {
    for (let t = 1; t <= TRIES_PER_MODEL; t++) {
      if (overBudget()) {
        return { observation: null, raw: lastRaw, model: null, outcome: 'unavailable', attempts }
      }

      let outcome: GenerateOutcome
      try {
        outcome = await deps.generate(model, input)
      } catch (err) {
        const { c, status } = classify(err)
        if (c.kind === 'skip_model') {
          attempts.push({ model, try: t, result: 'rejected_request', status })
          break
        }
        attempts.push({ model, try: t, result: c.kind === 'rate_limited' ? 'rate_limited' : 'unavailable', status })
        if (t < TRIES_PER_MODEL) {
          const fallback = BACKOFF_MS[t - 1]
          const suggested = c.kind === 'rate_limited' ? c.delayMs : null
          // A server delay longer than we are willing to wait means this model
          // is out for now; the next model is a better use of the budget.
          if (suggested !== null && suggested > MAX_SERVER_DELAY_MS) break
          await sleep(suggested ?? fallback)
        } else {
          await sleep(BACKOFF_MS[1])
        }
        continue
      }

      // A safety block or no candidate is not a malfunction to retry: the same
      // image will be blocked again. UNCLEAR, and the user can re-upload.
      if (outcome.blockReason || outcome.candidateCount === 0) {
        attempts.push({ model, try: t, result: 'blocked' })
        return { observation: null, raw: { blockReason: outcome.blockReason }, model, outcome: 'blocked', attempts }
      }

      const text = outcome.text ?? ''
      lastRaw = truncateRaw(text)
      const observation = observationFromModel(lastRaw)
      if (observation) {
        attempts.push({ model, try: t, result: 'ok' })
        return { observation, raw: lastRaw, model, outcome: 'ok', attempts }
      }

      attempts.push({ model, try: t, result: 'invalid_output' })
      invalidOutputs++
      // Failure matrix: malformed JSON gets one retry, then UNCLEAR.
      if (invalidOutputs >= 2) {
        return { observation: null, raw: lastRaw, model: null, outcome: 'invalid_output', attempts }
      }
    }
  }

  return { observation: null, raw: lastRaw, model: null, outcome: 'unavailable', attempts }
}

/**
 * The production GenerateFn, on @google/genai. `fetchImpl` exists for tests,
 * so the real SDK request path can be exercised without the network.
 */
export function sdkGenerate(apiKey: string, fetchImpl?: typeof fetch): GenerateFn {
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { timeout: REQUEST_TIMEOUT_MS, ...(fetchImpl ? { fetch: fetchImpl } : {}) },
  })
  return async (model, input) => {
    const thinkingConfig = thinkingConfigFor(model)
    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: input.mimeType, data: input.imageBase64 } },
            { text: buildExtractionPrompt(input.spec) },
          ],
        },
      ],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        ...GENERATION_SETTINGS,
        // The SDK's Schema type is an enum-typed mirror of the same JSON; the
        // literal in core is validated against the live API by the probe script.
        responseSchema: OBSERVATION_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
        ...(thinkingConfig ? { thinkingConfig } : {}),
      },
    })
    return {
      text: response.text ?? null,
      blockReason: response.promptFeedback?.blockReason ? String(response.promptFeedback.blockReason) : null,
      candidateCount: response.candidates?.length ?? 0,
    }
  }
}

/** Wire the chain from the function environment. Missing key -> empty chain. */
export function depsFromEnv(): ExtractDeps {
  const apiKey = Deno.env.get('GEMINI_API_KEY') ?? ''
  const models = apiKey ? parseModelChain(Deno.env.get('GEMINI_MODEL_CHAIN')) : []
  return { models, generate: sdkGenerate(apiKey) }
}
