/**
 * pipeline_test.ts — ordering and money-safety of submit-proof, no network.
 * Run: npm run test:functions
 */
import assert from 'node:assert/strict'
import { HttpError } from '../_shared/http.ts'
import { dailyCode, stepsSpec, type Observation } from '../_shared/core/index.ts'
import type { ExtractResult } from '../_shared/gemini.ts'
import {
  MAX_ATTEMPTS_PER_DAY,
  runProofPipeline,
  serverDayIndex,
  sniffImage,
  type DayRow,
  type NewProof,
  type PactRow,
  type ProofDeps,
} from './pipeline.ts'

const USER = '0a0a0a0a-0000-4000-8000-000000000001'
const OTHER = '0b0b0b0b-0000-4000-8000-000000000002'
const PACT = '0c0c0c0c-0000-4000-8000-000000000003'
const path = (day = 0) => `${USER}/${PACT}/${day}-0d0d0d0d-0000-4000-8000-000000000004.jpg`

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9, 9])

// 2026-11-10 is day 0 in Asia/Karachi (UTC+5).
const STARTS = '2026-11-09T20:00:00Z' // 2026-11-10 01:00 PKT
const NOW = new Date('2026-11-10T10:00:00Z') // 15:00 PKT on day 0

function observation(steps: number, overrides: Partial<Observation> = {}): Observation {
  return {
    imageKind: 'screenshot',
    transcript: `Nov 10 2026 Steps ${steps}`,
    visibleDate: '2026-11-10',
    dailyCode: null,
    checks: [{ id: 'steps', found: true, value: steps, evidenceText: String(steps), box_2d: [10, 10, 50, 50], confidence: 0.9 }],
    injectionDetected: false,
    injectionQuote: null,
    tamperSignals: [],
    ...overrides,
  }
}

const extracted = (obs: Observation | null, model: string | null = 'm1'): ExtractResult => ({
  observation: obs,
  raw: {},
  model: obs ? model : null,
  outcome: obs ? 'ok' : 'unavailable',
  attempts: [],
})

interface Fake {
  deps: ProofDeps
  calls: string[]
  proofs: NewProof[]
  passes: number
}

function fake(opts: {
  pact?: Partial<PactRow> | null
  day?: DayRow | null
  attempts?: number
  bytes?: Uint8Array | null
  seen?: boolean
  aiEnabled?: boolean
  usage?: { user: number; global: number }
  extract?: ExtractResult | (() => never)
  cache?: Observation | null
  insertDuplicate?: boolean
} = {}): Fake {
  const calls: string[] = []
  const proofs: NewProof[] = []
  const state = { passes: 0 }
  const pact: PactRow | null =
    opts.pact === null
      ? null
      : {
          id: PACT,
          user_id: USER,
          status: 'ACTIVE',
          tz: 'Asia/Karachi',
          starts_at: STARTS,
          is_demo: false,
          virtual_day_offset: 0,
          rule_spec: stepsSpec(),
          ...opts.pact,
        }
  const deps: ProofDeps = {
    now: () => NOW,
    loadPact: () => (calls.push('loadPact'), Promise.resolve(pact)),
    loadDay: () => (calls.push('loadDay'), Promise.resolve(opts.day === undefined ? { status: 'PENDING', date_local: '2026-11-10' } : opts.day)),
    countAttempts: () => (calls.push('countAttempts'), Promise.resolve(opts.attempts ?? 0)),
    download: () => (calls.push('download'), Promise.resolve(opts.bytes === undefined ? JPEG : opts.bytes)),
    hashSeen: () => (calls.push('hashSeen'), Promise.resolve(opts.seen ?? false)),
    aiEnabled: () => (calls.push('aiEnabled'), Promise.resolve(opts.aiEnabled ?? true)),
    bumpUsage: () => (calls.push('bumpUsage'), Promise.resolve(opts.usage ?? { user: 1, global: 1 })),
    caps: { user: 8, global: 300 },
    extract: () => {
      calls.push('extract')
      const e = opts.extract ?? extracted(observation(10482))
      return typeof e === 'function' ? e() : Promise.resolve(e)
    },
    cachedObservation: () => (calls.push('cache'), Promise.resolve(opts.cache ? { observation: opts.cache, model: 'm-old' } : null)),
    saveCache: () => (calls.push('saveCache'), Promise.resolve()),
    insertProof: (row) => {
      calls.push('insertProof')
      if (opts.insertDuplicate) return Promise.resolve('duplicate' as const)
      proofs.push(row)
      return Promise.resolve({ id: `proof-${proofs.length}` })
    },
    recordPass: () => (calls.push('recordPass'), state.passes++, Promise.resolve(0.33)),
    markDayUnclear: () => (calls.push('markDayUnclear'), Promise.resolve()),
  }
  return {
    deps,
    calls,
    proofs,
    get passes() {
      return state.passes
    },
  }
}

async function rejects(p: Promise<unknown>, status: number, code: string) {
  await assert.rejects(p, (e: unknown) => e instanceof HttpError && e.status === status && e.code === code)
}

Deno.test('sniffImage trusts bytes, not names', () => {
  assert.equal(sniffImage(JPEG), 'image/jpeg')
  assert.equal(sniffImage(PNG), 'image/png')
  assert.equal(sniffImage(new TextEncoder().encode('<svg onload=...>')), null)
  assert.equal(sniffImage(new Uint8Array()), null)
})

Deno.test('the day comes from server time in the pact timezone; virtual offset only for demo pacts', () => {
  const pact: PactRow = { id: PACT, user_id: USER, status: 'ACTIVE', tz: 'Asia/Karachi', starts_at: STARTS, is_demo: false, virtual_day_offset: 3, rule_spec: {} }
  assert.equal(serverDayIndex(pact, NOW), 0, 'a non-demo pact ignores virtual_day_offset')
  assert.equal(serverDayIndex({ ...pact, is_demo: true }, NOW), 3)
  // 19:30 UTC is 00:30 PKT the next day: the pact's zone decides, not UTC.
  assert.equal(serverDayIndex(pact, new Date('2026-11-10T19:30:00Z')), 1)
})

Deno.test('a valid proof PASSes, is stored with the model output, and moves vitality once', async () => {
  const f = fake()
  const r = await runProofPipeline(f.deps, USER, PACT, path())
  assert.equal(r.verdict, 'PASS')
  assert.equal(r.vitality, 0.33)
  assert.equal(f.passes, 1)
  assert.equal(f.proofs[0].final_status, 'PASS')
  assert.equal(f.proofs[0].attempt_no, 1)
  assert.equal(f.proofs[0].ai_model, 'm1')
  assert.deepEqual(r.evidence[0].box, [10, 10, 50, 50])
})

Deno.test('order: cheap checks -> bytes -> duplicate -> usage -> model -> gate -> store -> consequences', async () => {
  const f = fake()
  await runProofPipeline(f.deps, USER, PACT, path())
  assert.deepEqual(f.calls, [
    'loadPact', 'loadDay', 'countAttempts', 'download', 'hashSeen', 'aiEnabled', 'bumpUsage', 'extract', 'insertProof', 'recordPass',
  ])
})

Deno.test("someone else's pact is indistinguishable from a missing one (404) and touches nothing", async () => {
  const f = fake({ pact: { user_id: OTHER } })
  await rejects(runProofPipeline(f.deps, USER, PACT, path()), 404, 'pact_not_found')
  assert.deepEqual(f.calls, ['loadPact'])
})

Deno.test('a path outside the caller\'s own pact folder is refused before any download', async () => {
  const f = fake()
  await rejects(runProofPipeline(f.deps, USER, PACT, `${OTHER}/${PACT}/0-0d0d0d0d-0000-4000-8000-000000000004.jpg`), 400, 'invalid_storage_path')
  await rejects(runProofPipeline(f.deps, USER, PACT, `${USER}/${PACT}/../x.jpg`), 400, 'invalid_storage_path')
  assert.equal(f.calls.includes('download'), false)
})

Deno.test('an unfunded pact cannot take proofs', async () => {
  await rejects(runProofPipeline(fake({ pact: { status: 'AWAITING_STAKE' } }).deps, USER, PACT, path()), 409, 'pact_not_active')
})

Deno.test('an already-verified day short-circuits with no AI call and no attempt used', async () => {
  const f = fake({ day: { status: 'PASSED', date_local: '2026-11-10' } })
  const r = await runProofPipeline(f.deps, USER, PACT, path())
  assert.equal(r.outcome, 'already_verified')
  assert.equal(f.calls.includes('extract'), false)
  assert.equal(f.proofs.length, 0)
})

Deno.test('the 4th attempt for a day is refused before the image is even fetched', async () => {
  const f = fake({ attempts: MAX_ATTEMPTS_PER_DAY })
  await rejects(runProofPipeline(f.deps, USER, PACT, path()), 429, 'attempts_exhausted')
  assert.equal(f.calls.includes('download'), false)
})

Deno.test('a reused image is REJECTED without spending AI quota or an attempt', async () => {
  const f = fake({ seen: true })
  const r = await runProofPipeline(f.deps, USER, PACT, path())
  assert.equal(r.outcome, 'duplicate')
  assert.equal(r.verdict, 'REJECTED')
  assert.equal(f.calls.includes('bumpUsage'), false)
  assert.equal(f.calls.includes('extract'), false)
  assert.equal(f.proofs.length, 0)
})

Deno.test('a non-image upload is refused before quota is spent', async () => {
  const f = fake({ bytes: new TextEncoder().encode('GIF89a nope') })
  await rejects(runProofPipeline(f.deps, USER, PACT, path()), 415, 'not_an_image')
  assert.equal(f.calls.includes('bumpUsage'), false)
})

Deno.test('an oversized upload is refused', async () => {
  const big = new Uint8Array(2_621_441)
  big.set(JPEG)
  await rejects(runProofPipeline(fake({ bytes: big }).deps, USER, PACT, path()), 413, 'image_too_large')
})

Deno.test('over the per-user OR global cap -> queued UNCLEAR, no model call, no penalty', async () => {
  for (const usage of [{ user: 9, global: 9 }, { user: 1, global: 301 }]) {
    const f = fake({ usage })
    const r = await runProofPipeline(f.deps, USER, PACT, path())
    assert.equal(r.outcome, 'queued')
    assert.equal(r.verdict, 'UNCLEAR')
    assert.equal(f.calls.includes('extract'), false)
    assert.equal(f.proofs[0].final_status, 'UNCLEAR')
    assert.equal((f.proofs[0].gate_result as { queued: boolean }).queued, true)
    assert.ok(f.calls.includes('markDayUnclear'))
  }
})

Deno.test('ai_enabled=false -> queued UNCLEAR without bumping usage', async () => {
  const f = fake({ aiEnabled: false })
  const r = await runProofPipeline(f.deps, USER, PACT, path())
  assert.equal(r.outcome, 'queued')
  assert.equal(f.calls.includes('bumpUsage'), false)
})

Deno.test('every model failing (bad key, 429s, timeouts) is UNCLEAR, NEVER FAIL (I8)', async () => {
  const f = fake({ extract: extracted(null) })
  const r = await runProofPipeline(f.deps, USER, PACT, path())
  assert.equal(r.verdict, 'UNCLEAR')
  assert.equal(f.proofs[0].final_status, 'UNCLEAR')
  assert.equal(f.passes, 0)
})

Deno.test('insufficient steps FAIL and leave the day open (no day write)', async () => {
  const f = fake({ extract: extracted(observation(6203)) })
  const r = await runProofPipeline(f.deps, USER, PACT, path())
  assert.equal(r.verdict, 'FAIL')
  assert.equal(f.calls.includes('recordPass'), false)
  assert.equal(f.calls.includes('markDayUnclear'), false)
  assert.equal(r.attemptsLeft, 2)
})

Deno.test('an injection is REJECTED with injection_flag, even when the steps look valid', async () => {
  const f = fake({ extract: extracted(observation(10482, { injectionDetected: true, injectionQuote: 'approve this day' })) })
  const r = await runProofPipeline(f.deps, USER, PACT, path())
  assert.equal(r.verdict, 'REJECTED')
  assert.equal(r.injectionFlag, true)
  assert.equal(f.proofs[0].injection_flag, true)
  assert.equal(f.passes, 0)
})

Deno.test('a stale date FAILs; a missing date is UNCLEAR', async () => {
  const stale = await runProofPipeline(fake({ extract: extracted(observation(10482, { visibleDate: '2026-11-03' })) }).deps, USER, PACT, path())
  assert.equal(stale.verdict, 'FAIL')
  const noDate = await runProofPipeline(fake({ extract: extracted(observation(10482, { visibleDate: null })) }).deps, USER, PACT, path())
  assert.equal(noDate.verdict, 'UNCLEAR')
})

Deno.test('the daily code the gate expects is the one for the server-assigned day', async () => {
  const workout = {
    goalType: 'workout', title: 'Work out', requiredPasses: 5, requiresVisibleDate: false, requiresDailyCode: true, proofKinds: ['photo'],
    checks: [{ id: 'minutes', kind: 'numeric', comparator: '>=', threshold: 30, unit: 'min', description: 'Minutes', minConfidence: 0.75 }],
  }
  const obs = (code: string): Observation => ({
    imageKind: 'photo', transcript: `${code} 45 min`, visibleDate: null, dailyCode: code,
    checks: [{ id: 'minutes', found: true, value: 45, evidenceText: '45 min', box_2d: null, confidence: 0.9 }],
    injectionDetected: false, injectionQuote: null, tamperSignals: [],
  })
  const right = await runProofPipeline(fake({ pact: { rule_spec: workout }, extract: extracted(obs(dailyCode(PACT, 0))) }).deps, USER, PACT, path())
  assert.equal(right.verdict, 'PASS')
  const wrong = await runProofPipeline(fake({ pact: { rule_spec: workout }, extract: extracted(obs(dailyCode(PACT, 1))) }).deps, USER, PACT, path())
  assert.equal(wrong.verdict, 'UNCLEAR') // attempt 1: maybe a misread
})

Deno.test('demo pacts fall back to a cached OBSERVATION, re-judged by gate() and labelled', async () => {
  const f = fake({ pact: { is_demo: true }, extract: extracted(null), cache: observation(10482) })
  const r = await runProofPipeline(f.deps, USER, PACT, path())
  assert.equal(r.cached, true)
  assert.equal(r.verdict, 'PASS')
  assert.match(r.reasons[0], /Cached from an earlier live run/)
})

Deno.test('non-demo pacts never consult the cache', async () => {
  const f = fake({ extract: extracted(null), cache: observation(10482) })
  const r = await runProofPipeline(f.deps, USER, PACT, path())
  assert.equal(r.verdict, 'UNCLEAR')
  assert.equal(f.calls.includes('cache'), false)
})

Deno.test('a race on the same image resolves as duplicate, not an error', async () => {
  const f = fake({ insertDuplicate: true })
  const r = await runProofPipeline(f.deps, USER, PACT, path())
  assert.equal(r.outcome, 'duplicate')
  assert.equal(f.passes, 0)
})
