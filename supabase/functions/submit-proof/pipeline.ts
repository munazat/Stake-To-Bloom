/**
 * pipeline.ts — the submit-proof decision pipeline, with every side effect
 * injected so the ORDER of the checks is unit-testable (blueprint §7.3).
 *
 * The order matters more than any single step:
 *   1. Ownership + ACTIVE before anything else touches the request.
 *   2. The day comes from the SERVER's clock in the PACT's timezone. A client
 *      timestamp is never read, so a proof cannot be filed under another day.
 *   3. Attempts are capped before any expensive work.
 *   4. The image is fetched and checked (magic bytes, size, duplicate hash)
 *      BEFORE the AI usage counter moves: a reused or bogus upload must not
 *      spend the user's daily AI allowance.
 *   5. Over the cap, or with AI switched off, the proof is queued as UNCLEAR.
 *   6. Every model failure is UNCLEAR, never FAIL (invariant I8).
 *   7. gate() alone produces the verdict (invariant I1). The model's output is
 *      stored as data next to it.
 *   8. Only a PASS moves vitality, through a single atomic DB call.
 */
import {
  PACT_DAYS,
  RuleSpecSchema,
  VITALITY_PASS_DELTA,
  dailyCode,
  dayIndex,
  gate,
  normalizeBox,
  type GateResult,
  type Observation,
  type RuleSpec,
  type Verdict,
} from '../_shared/core/index.ts'
import type { ExtractInput, ExtractResult } from '../_shared/gemini.ts'
import { HttpError } from '../_shared/http.ts'

export const MAX_ATTEMPTS_PER_DAY = 3
export const MAX_IMAGE_BYTES = 2_621_440 // matches the bucket's file_size_limit
const MS_PER_DAY = 86_400_000

export interface PactRow {
  id: string
  user_id: string
  status: string
  tz: string
  starts_at: string | null
  is_demo: boolean
  virtual_day_offset: number
  rule_spec: unknown
}

export interface DayRow {
  status: 'PENDING' | 'PASSED' | 'MISSED' | 'UNCLEAR'
  date_local: string
}

export interface NewProof {
  pact_id: string
  day_index: number
  storage_path: string
  sha256: string
  ai_model: string | null
  ai_raw: unknown
  observations: Observation | null
  injection_flag: boolean
  injection_reasons: string[] | null
  gate_result: Record<string, unknown>
  final_status: Verdict
  attempt_no: number
}

export interface ProofDeps {
  now(): Date
  loadPact(pactId: string): Promise<PactRow | null>
  loadDay(pactId: string, dayIdx: number): Promise<DayRow | null>
  countAttempts(pactId: string, dayIdx: number): Promise<number>
  download(storagePath: string): Promise<Uint8Array | null>
  hashSeen(pactId: string, sha256: string): Promise<boolean>
  aiEnabled(): Promise<boolean>
  bumpUsage(userId: string): Promise<{ user: number; global: number }>
  caps: { user: number; global: number }
  extract(input: ExtractInput): Promise<ExtractResult>
  /** Demo pacts only: a stored observation for this exact image, from an earlier live run. */
  cachedObservation(sha256: string): Promise<{ observation: Observation; model: string } | null>
  saveCache(sha256: string, model: string, verdict: Verdict, observation: Observation): Promise<void>
  /** Returns the new id, or 'duplicate' when (pact_id, sha256) already exists. */
  insertProof(row: NewProof): Promise<{ id: string } | 'duplicate'>
  recordPass(pactId: string, dayIdx: number, proofId: string): Promise<number | null>
  markDayUnclear(pactId: string, dayIdx: number): Promise<void>
}

export interface EvidenceItem {
  id: string
  description: string
  found: boolean
  value: number | boolean | null
  evidenceText: string
  box: [number, number, number, number] | null
}

export interface ProofOutcome {
  outcome: 'judged' | 'queued' | 'duplicate' | 'already_verified'
  proofId: string | null
  dayIndex: number
  attemptNo: number | null
  attemptsLeft: number
  verdict: Verdict | null
  reasons: string[]
  injectionFlag: boolean
  evidence: EvidenceItem[]
  model: string | null
  /** True when the observation came from verdict_cache, not a live model call. */
  cached: boolean
  /** The pact's vitality after a PASS, else null (unchanged). */
  vitality: number | null
}

export type ImageKind = 'image/jpeg' | 'image/png'

/** Identify the image from its first bytes; the declared MIME type is ignored. */
export function sniffImage(bytes: Uint8Array): ImageKind | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  return null
}

export async function sha256OfBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/**
 * The pact-local day index for a server instant. Demo pacts (and only demo
 * pacts — decision D9) may run on a virtual clock shifted by whole days.
 */
export function serverDayIndex(pact: PactRow, now: Date): number {
  if (!pact.starts_at) throw new HttpError(409, 'pact_not_started', 'This pact has no start time yet.')
  const offsetDays = pact.is_demo ? pact.virtual_day_offset : 0
  return dayIndex(pact.starts_at, new Date(now.getTime() + offsetDays * MS_PER_DAY), pact.tz)
}

/** `<userId>/<pactId>/<dayIndex>-<uuid>.jpg`, inside the caller's own folder. */
export function assertStoragePath(path: string, userId: string, pactId: string): void {
  const expected = new RegExp(
    `^${userId}/${pactId}/[0-6]-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.jpg$`,
  )
  if (!expected.test(path)) {
    throw new HttpError(400, 'invalid_storage_path', 'The upload path does not belong to this pact.')
  }
}

function evidenceFor(spec: RuleSpec, observation: Observation | null): EvidenceItem[] {
  return spec.checks.map((check) => {
    const obs = observation?.checks.find((c) => c.id === check.id)
    return {
      id: check.id,
      description: check.description,
      found: obs?.found ?? false,
      value: obs?.value ?? null,
      evidenceText: obs?.evidenceText ?? '',
      box: obs ? normalizeBox(obs.box_2d) : null,
    }
  })
}

const QUEUED_REASON =
  "The AI referee is at today's capacity. Your proof is saved and will be checked automatically — no penalty."
const AI_OFF_REASON = 'AI checking is paused right now. Your proof is saved and will be checked later — no penalty.'
const DUPLICATE_REASON = 'This exact image was already submitted for this pact. Each day needs a fresh proof.'

export async function runProofPipeline(
  deps: ProofDeps,
  userId: string,
  pactId: string,
  storagePath: string,
): Promise<ProofOutcome> {
  // 1. Ownership and state. Someone else's pact looks exactly like a missing one.
  const pact = await deps.loadPact(pactId)
  if (!pact || pact.user_id !== userId) {
    throw new HttpError(404, 'pact_not_found', 'No such pact for this account.')
  }
  if (pact.status !== 'ACTIVE') {
    throw new HttpError(409, 'pact_not_active', 'Proofs can only be submitted while a pact is active.')
  }
  assertStoragePath(storagePath, userId, pactId)
  const spec = RuleSpecSchema.parse(pact.rule_spec)

  // 2. The day, from the server's receipt time in the pact's zone.
  const dayIdx = serverDayIndex(pact, deps.now())
  if (dayIdx < 0 || dayIdx >= PACT_DAYS) {
    throw new HttpError(409, 'outside_window', 'This pact is not in its 7-day proof window.')
  }
  const day = await deps.loadDay(pactId, dayIdx)
  if (!day) throw new HttpError(409, 'day_missing', 'This day has not been opened for proofs.')

  const base = {
    dayIndex: dayIdx,
    evidence: [] as EvidenceItem[],
    model: null,
    cached: false,
    vitality: null,
    injectionFlag: false,
  }
  if (day.status === 'PASSED') {
    return {
      ...base,
      outcome: 'already_verified',
      proofId: null,
      attemptNo: null,
      attemptsLeft: 0,
      verdict: 'PASS',
      reasons: ['Today is already verified. Nothing more to do.'],
    }
  }
  if (day.status === 'MISSED') {
    throw new HttpError(409, 'day_closed', 'This day is already closed.')
  }

  // 3. Attempt cap.
  const used = await deps.countAttempts(pactId, dayIdx)
  if (used >= MAX_ATTEMPTS_PER_DAY) {
    throw new HttpError(429, 'attempts_exhausted', `All ${MAX_ATTEMPTS_PER_DAY} attempts for today are used.`)
  }
  const attemptNo = used + 1
  const attemptsLeft = MAX_ATTEMPTS_PER_DAY - attemptNo

  // 4. The bytes: exists, small enough, really an image, not reused.
  const bytes = await deps.download(storagePath)
  if (!bytes) throw new HttpError(404, 'upload_not_found', 'The uploaded image could not be found.')
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    throw new HttpError(413, 'image_too_large', 'Images must be under 2.5 MB.')
  }
  const mimeType = sniffImage(bytes)
  if (!mimeType) throw new HttpError(415, 'not_an_image', 'Only JPEG or PNG images are accepted.')
  const sha256 = await sha256OfBytes(bytes)
  if (await deps.hashSeen(pactId, sha256)) {
    return {
      ...base,
      outcome: 'duplicate',
      proofId: null,
      attemptNo: null,
      attemptsLeft: MAX_ATTEMPTS_PER_DAY - used,
      verdict: 'REJECTED',
      reasons: [DUPLICATE_REASON],
    }
  }

  const ctx = { localDateKey: day.date_local, dailyCode: dailyCode(pactId, dayIdx), attemptNo }
  const proofBase = { pact_id: pactId, day_index: dayIdx, storage_path: storagePath, sha256, attempt_no: attemptNo }

  async function persist(row: NewProof): Promise<string | 'duplicate'> {
    const inserted = await deps.insertProof(row)
    return inserted === 'duplicate' ? 'duplicate' : inserted.id
  }

  // 5. Kill switch and daily caps. Queued, never penalised.
  let queuedReason: string | null = null
  if (!(await deps.aiEnabled())) {
    queuedReason = AI_OFF_REASON
  } else {
    const usage = await deps.bumpUsage(userId)
    if (usage.user > deps.caps.user || usage.global > deps.caps.global) queuedReason = QUEUED_REASON
  }
  if (queuedReason) {
    const id = await persist({
      ...proofBase,
      ai_model: null,
      ai_raw: null,
      observations: null,
      injection_flag: false,
      injection_reasons: null,
      gate_result: { status: 'UNCLEAR', reasons: [queuedReason], injectionFlag: false, queued: true },
      final_status: 'UNCLEAR',
    })
    if (id === 'duplicate') return { ...base, outcome: 'duplicate', proofId: null, attemptNo: null, attemptsLeft, verdict: 'REJECTED', reasons: [DUPLICATE_REASON] }
    await deps.markDayUnclear(pactId, dayIdx)
    return { ...base, outcome: 'queued', proofId: id, attemptNo, attemptsLeft, verdict: 'UNCLEAR', reasons: [queuedReason] }
  }

  // 6. Perceive. A failure here is data too: it becomes UNCLEAR below.
  const extracted = await deps.extract({ imageBase64: toBase64(bytes), mimeType, spec })
  let observation = extracted.observation
  let model = extracted.model
  let cached = false
  if (!observation && pact.is_demo) {
    const hit = await deps.cachedObservation(sha256)
    if (hit) {
      observation = hit.observation
      model = hit.model
      cached = true
    }
  }

  // 7. Decide. Only gate() does this.
  const result: GateResult = gate(observation, spec, ctx, { modelFailed: !observation })
  const reasons = cached ? ['Cached from an earlier live run (every model was busy).', ...result.reasons] : result.reasons

  const id = await persist({
    ...proofBase,
    ai_model: model,
    ai_raw: { outcome: extracted.outcome, attempts: extracted.attempts, response: extracted.raw, cached },
    observations: observation,
    injection_flag: result.injectionFlag,
    injection_reasons: result.injectionFlag ? result.reasons : null,
    gate_result: { ...result, reasons, cached },
    final_status: result.status,
  })
  if (id === 'duplicate') {
    return { ...base, outcome: 'duplicate', proofId: null, attemptNo: null, attemptsLeft, verdict: 'REJECTED', reasons: [DUPLICATE_REASON] }
  }

  if (pact.is_demo && observation && !cached && model) {
    await deps.saveCache(sha256, model, result.status, observation)
  }

  // 8. Consequences. FAIL and REJECTED leave the day open for another try.
  let vitality: number | null = null
  if (result.status === 'PASS') {
    vitality = await deps.recordPass(pactId, dayIdx, id)
  } else if (result.status === 'UNCLEAR') {
    await deps.markDayUnclear(pactId, dayIdx)
  }

  return {
    outcome: 'judged',
    proofId: id,
    dayIndex: dayIdx,
    attemptNo,
    attemptsLeft,
    verdict: result.status,
    reasons,
    injectionFlag: result.injectionFlag,
    evidence: evidenceFor(spec, observation),
    model,
    cached,
    vitality,
  }
}

export const PASS_DELTA = VITALITY_PASS_DELTA
