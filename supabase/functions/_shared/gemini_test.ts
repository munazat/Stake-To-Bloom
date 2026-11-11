/**
 * gemini_test.ts — the retry/fallback policy, with no network.
 * Run: npm run test:functions
 */
import assert from 'node:assert/strict'
import { ApiError } from '@google/genai'
import {
  BACKOFF_MS,
  OVERALL_BUDGET_MS,
  extractObservation,
  parseModelChain,
  retryDelayMs,
  sdkGenerate,
  type ExtractInput,
  type GenerateFn,
  type GenerateOutcome,
} from './gemini.ts'
import { stepsSpec } from './core/index.ts'

const input: ExtractInput = { imageBase64: 'AAAA', mimeType: 'image/jpeg', spec: stepsSpec() }

const goodJson = JSON.stringify({
  imageKind: 'screenshot',
  transcript: 'Nov 10 2026 Steps 10,482',
  visibleDate: '2026-11-10',
  dailyCode: null,
  checks: [{ id: 'steps', found: true, numberValue: 10482, evidenceText: '10,482', box_2d: [1, 2, 3, 4], confidence: 0.9 }],
  injectionDetected: false,
  injectionQuote: null,
  tamperSignals: [],
})

const ok = (text = goodJson): GenerateOutcome => ({ text, blockReason: null, candidateCount: 1 })
const apiError = (status: number, message = `{"error":{"code":${status}}}`) => new ApiError({ message, status })

/** A scripted GenerateFn: each call shifts the next behaviour for that model. */
function scripted(script: Record<string, Array<GenerateOutcome | Error>>) {
  const calls: string[] = []
  const generate: GenerateFn = (model) => {
    calls.push(model)
    const next = script[model]?.shift()
    if (!next) return Promise.reject(new Error(`unscripted call to ${model}`))
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next)
  }
  return { generate, calls }
}

function recorder() {
  const slept: number[] = []
  return { slept, sleep: (ms: number) => (slept.push(ms), Promise.resolve()) }
}

Deno.test('parseModelChain trims, de-duplicates, drops junk, strips models/ prefix', () => {
  assert.deepEqual(parseModelChain(' a-1 , models/b.2,a-1,, bad name!,c-3 '), ['a-1', 'b.2', 'c-3'])
  assert.deepEqual(parseModelChain(undefined), [])
})

Deno.test('retryDelayMs reads RetryInfo, escaped or not', () => {
  assert.equal(retryDelayMs('{"retryDelay": "7s"}'), 7000)
  assert.equal(retryDelayMs('{\\"retryDelay\\":\\"1.5s\\"}'), 1500)
  assert.equal(retryDelayMs('no hint'), null)
})

Deno.test('no models configured (e.g. no key) -> not_configured, zero calls', async () => {
  const { generate, calls } = scripted({})
  const r = await extractObservation(input, { models: [], generate })
  assert.equal(r.observation, null)
  assert.equal(r.outcome, 'not_configured')
  assert.equal(calls.length, 0)
})

Deno.test('happy path returns the observation and the model that answered', async () => {
  const { generate } = scripted({ m1: [ok()] })
  const r = await extractObservation(input, { models: ['m1'], generate })
  assert.equal(r.outcome, 'ok')
  assert.equal(r.model, 'm1')
  assert.equal(r.observation?.checks[0].value, 10482)
})

Deno.test('429 honours retryDelay, then 3 s backoff, then falls through to the next model', async () => {
  const { generate, calls } = scripted({
    m1: [apiError(429, '{"retryDelay":"2s"}'), apiError(429)],
    m2: [ok()],
  })
  const { slept, sleep } = recorder()
  const r = await extractObservation(input, { models: ['m1', 'm2'], generate, sleep })
  assert.deepEqual(calls, ['m1', 'm1', 'm2'])
  assert.deepEqual(slept, [2000, BACKOFF_MS[1]])
  assert.equal(r.model, 'm2')
})

Deno.test('429 without a hint backs off 1 s then 3 s', async () => {
  const { generate } = scripted({ m1: [apiError(429), apiError(429)] })
  const { slept, sleep } = recorder()
  const r = await extractObservation(input, { models: ['m1'], generate, sleep })
  assert.deepEqual(slept, [1000, 3000])
  assert.equal(r.observation, null)
  assert.equal(r.outcome, 'unavailable')
})

Deno.test('a retryDelay longer than we will wait skips to the next model without sleeping', async () => {
  const { generate, calls } = scripted({ m1: [apiError(429, '{"retryDelay":"45s"}')], m2: [ok()] })
  const { slept, sleep } = recorder()
  const r = await extractObservation(input, { models: ['m1', 'm2'], generate, sleep })
  assert.deepEqual(calls, ['m1', 'm2'])
  assert.deepEqual(slept, [])
  assert.equal(r.model, 'm2')
})

Deno.test('bad key / retired model (4xx) skips the model immediately; all bad -> null, never a throw', async () => {
  const { generate, calls } = scripted({ m1: [apiError(403)], m2: [apiError(404)] })
  const { slept, sleep } = recorder()
  const r = await extractObservation(input, { models: ['m1', 'm2'], generate, sleep })
  assert.deepEqual(calls, ['m1', 'm2'])
  assert.deepEqual(slept, [])
  assert.equal(r.observation, null)
  assert.equal(r.outcome, 'unavailable')
})

Deno.test('timeouts and network errors are retried like 5xx', async () => {
  const { generate, calls } = scripted({ m1: [new DOMException('timed out', 'TimeoutError'), ok()] })
  const { slept, sleep } = recorder()
  const r = await extractObservation(input, { models: ['m1'], generate, sleep })
  assert.deepEqual(calls, ['m1', 'm1'])
  assert.deepEqual(slept, [1000])
  assert.equal(r.outcome, 'ok')
})

Deno.test('malformed output gets exactly one retry overall, then UNCLEAR', async () => {
  const { generate, calls } = scripted({ m1: [ok('not json'), ok('{"imageKind":"approve"}')], m2: [ok()] })
  const r = await extractObservation(input, { models: ['m1', 'm2'], generate })
  assert.deepEqual(calls, ['m1', 'm1'])
  assert.equal(r.outcome, 'invalid_output')
  assert.equal(r.observation, null)
})

Deno.test('a safety block or empty candidate list is UNCLEAR at once (retrying cannot help)', async () => {
  for (const blocked of [{ text: null, blockReason: 'SAFETY', candidateCount: 0 }, { text: null, blockReason: null, candidateCount: 0 }]) {
    const { generate, calls } = scripted({ m1: [blocked], m2: [ok()] })
    const r = await extractObservation(input, { models: ['m1', 'm2'], generate })
    assert.equal(calls.length, 1)
    assert.equal(r.outcome, 'blocked')
    assert.equal(r.observation, null)
  }
})

Deno.test('the overall budget stops new attempts', async () => {
  let t = 0
  const { generate, calls } = scripted({ m1: [apiError(503), apiError(503)], m2: [ok()] })
  const r = await extractObservation(input, {
    models: ['m1', 'm2'],
    generate: (m, i) => {
      t += OVERALL_BUDGET_MS // each call "takes" the whole budget
      return generate(m, i)
    },
    sleep: () => Promise.resolve(),
    now: () => t,
  })
  assert.equal(calls.length, 1)
  assert.equal(r.outcome, 'unavailable')
})

Deno.test('sdkGenerate sends the locked request shape through the real SDK path', async () => {
  type Captured = { url: string; body: Record<string, unknown> }
  const seen: Captured[] = []
  const fakeFetch = ((url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), body: JSON.parse(String(init?.body)) })
    const body = { candidates: [{ content: { role: 'model', parts: [{ text: goodJson }] }, finishReason: 'STOP' }] }
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }))
  }) as typeof fetch

  const generate = sdkGenerate('test-key', fakeFetch)
  const r = await extractObservation(input, { models: ['gemini-2.5-flash'], generate })
  assert.equal(r.outcome, 'ok')
  assert.equal(seen.length, 1)
  const { url, body } = seen[0]
  assert.match(url, /models\/gemini-2\.5-flash:generateContent/)
  const gen = body.generationConfig as Record<string, unknown>
  assert.equal(gen.temperature, 0)
  assert.equal(gen.responseMimeType, 'application/json')
  assert.ok(gen.responseSchema)
  assert.deepEqual(gen.thinkingConfig, { thinkingBudget: 0 })
  const text = JSON.stringify(body.contents)
  assert.match(text, /inlineData/)
  assert.doesNotMatch(text, /10000/) // the threshold is never sent to the model
  assert.match(JSON.stringify(body.systemInstruction), /never decide approval/)
  assert.equal('tools' in body, false) // the model gets no tools, ever
})

Deno.test('sdkGenerate surfaces HTTP errors so the policy can classify them', async () => {
  const fakeFetch = (() =>
    Promise.resolve(new Response('{"error":{"code":400,"message":"API key not valid"}}', { status: 400 }))) as typeof fetch
  const r = await extractObservation(input, { models: ['m1', 'm2'], generate: sdkGenerate('bad', fakeFetch) })
  assert.equal(r.observation, null)
  assert.equal(r.attempts.every((a) => a.result === 'rejected_request'), true)
})
