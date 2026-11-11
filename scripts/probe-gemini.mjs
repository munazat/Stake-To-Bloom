#!/usr/bin/env node
/**
 * probe-gemini.mjs — find the Gemini models that actually work for BloomStake.
 *
 * Model names are unstable (retirements, previews), so nothing is hardcoded:
 * this asks the API which models the key can see, then sends each GA
 * candidate the REAL request (same system instruction, response schema and
 * settings as the Edge Function, from packages/core) with a generated sample
 * proof, and checks the answer reads 10,482 steps and the right date.
 *
 * Output: the working chain, best first, as a ready-to-use line:
 *   GEMINI_MODEL_CHAIN=model-a,model-b
 *
 * Usage:
 *   node scripts/probe-gemini.mjs [--image path.png] [--all]
 * Key: GEMINI_API_KEY in the environment, or supabase/functions/.env.
 * The key is sent in a header and is never printed.
 * --all also tests preview/experimental models (reported, never preferred).
 */
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const wantAll = args.includes('--all')
const imageArg = args.includes('--image') ? args[args.indexOf('--image') + 1] : null

function loadKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim()
  const file = join(root, 'supabase/functions/.env')
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^GEMINI_API_KEY=(.*)$/.exec(line)
      if (m) return m[1].trim().replace(/^["']|["']$/g, '')
    }
  }
  return ''
}

const key = loadKey()
if (!key) {
  console.error('GEMINI_API_KEY is not set (environment or supabase/functions/.env).')
  process.exit(1)
}

const core = await import(pathToFileURL(join(root, 'packages/core/src/index.ts')).href)
const {
  SYSTEM_INSTRUCTION,
  OBSERVATION_RESPONSE_SCHEMA,
  GENERATION_SETTINGS,
  buildExtractionPrompt,
  observationFromModel,
  thinkingConfigFor,
  stepsSpec,
  gate,
  PROMPT_VERSION,
} = core

const BASE = 'https://generativelanguage.googleapis.com/v1beta'
const today = new Date().toISOString().slice(0, 10)

/** Render a sample steps screen with headless Chromium (no image deps needed). */
function sampleImage() {
  if (imageArg) return { data: readFileSync(imageArg), mime: imageArg.endsWith('.png') ? 'image/png' : 'image/jpeg' }
  const candidates = [
    process.env.CHROME_BIN,
    'C:/Users/DELL/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].filter(Boolean)
  const chrome = candidates.find((c) => existsSync(c))
  if (!chrome) {
    console.error('No Chrome/Chromium found to render a sample. Pass --image path.png or set CHROME_BIN.')
    process.exit(1)
  }
  const dir = mkdtempSync(join(tmpdir(), 'bloom-probe-'))
  const html = join(dir, 'sample.html')
  const png = join(dir, 'sample.png')
  writeFileSync(
    html,
    `<body style="margin:0;background:#101820;color:#fff;font-family:Arial,sans-serif;width:720px;height:960px">
<div style="padding:48px"><div style="font-size:28px;color:#8fd3a8">Daily activity</div>
<div style="font-size:26px;margin-top:8px">${today}</div>
<div style="font-size:120px;font-weight:700;margin-top:120px">10,482</div>
<div style="font-size:34px">steps</div>
<div style="margin-top:80px;font-size:24px;color:#aab">Goal 8,000 · 7.9 km · 412 kcal</div></div></body>`,
  )
  const r = spawnSync(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', `--screenshot=${png}`, '--window-size=720,960', pathToFileURL(html).href], {
    encoding: 'utf8',
    timeout: 60_000,
  })
  if (!existsSync(png)) {
    console.error('Chrome could not render the sample image:', (r.stderr || '').slice(0, 300))
    process.exit(1)
  }
  return { data: readFileSync(png), mime: 'image/png' }
}

async function api(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'x-goog-api-key': key, 'content-type': 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(45_000),
  })
  const text = await res.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = { raw: text.slice(0, 200) }
  }
  return { status: res.status, body }
}

async function listModels() {
  const out = []
  let token = ''
  for (let i = 0; i < 10; i++) {
    const r = await api(`/models?pageSize=100${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`)
    if (r.status !== 200) {
      console.error(`Listing models failed: HTTP ${r.status} ${r.body?.error?.message ?? ''}`)
      if (r.status === 400 || r.status === 403) console.error('The API key looks invalid or lacks access.')
      process.exit(1)
    }
    out.push(...(r.body.models ?? []))
    token = r.body.nextPageToken ?? ''
    if (!token) break
  }
  return out
}

const NOT_TEXT_VISION = /(tts|image|imagen|live|audio|embedding|robotics|computer-use|native|veo|lyria|learnlm|aqa|gemma|deep-research)/i
const isPreview = (n) => /(preview|exp|experimental|-0\d\d\b|\d{2}-\d{2})/i.test(n)

function rank(name) {
  // Higher is better: newer major/minor, flash over flash-lite. Free-tier friendly.
  const m = /gemini-(\d+)(?:\.(\d+))?-(flash(?:-lite)?)/.exec(name)
  if (!m) return -1
  const version = Number(m[1]) + Number(m[2] ?? 0) / 10
  return version * 10 + (m[3] === 'flash' ? 1 : 0)
}

const img = sampleImage()
const spec = stepsSpec()
const models = await listModels()
const candidates = models
  .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
  .map((m) => m.name.replace(/^models\//, ''))
  .filter((n) => /^gemini-/.test(n) && /flash/i.test(n) && !NOT_TEXT_VISION.test(n))
  .filter((n) => wantAll || !isPreview(n))
  .sort((a, b) => rank(b) - rank(a) || a.localeCompare(b))

console.log(`Prompt ${PROMPT_VERSION}. Key can see ${models.length} models; testing ${candidates.length} GA flash-class candidate(s).\n`)
if (candidates.length === 0) {
  console.error('No GA flash candidates found. Re-run with --all to include previews.')
  process.exit(1)
}

const working = []
for (const name of candidates.slice(0, 8)) {
  const thinking = thinkingConfigFor(name)
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [
      {
        role: 'user',
        parts: [{ inlineData: { mimeType: img.mime, data: img.data.toString('base64') } }, { text: buildExtractionPrompt(spec) }],
      },
    ],
    generationConfig: {
      ...GENERATION_SETTINGS,
      responseSchema: OBSERVATION_RESPONSE_SCHEMA,
      ...(thinking ? { thinkingConfig: thinking } : {}),
    },
  }
  const t0 = Date.now()
  let r
  try {
    r = await api(`/models/${name}:generateContent`, { method: 'POST', body: JSON.stringify(body) })
  } catch (err) {
    console.log(`  FAIL  ${name.padEnd(30)} no answer in 45s (${err?.name ?? 'error'})`)
    continue
  }
  const ms = Date.now() - t0
  if (r.status !== 200) {
    const why = (r.body?.error?.message ?? '').replace(/\s+/g, ' ').slice(0, 110)
    console.log(`  FAIL  ${name.padEnd(30)} HTTP ${r.status}  ${why}`)
    continue
  }
  let obs = null
  try {
    obs = observationFromModel(JSON.parse(r.body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''))
  } catch {}
  if (!obs) {
    console.log(`  FAIL  ${name.padEnd(30)} 200 but output did not match the schema`)
    continue
  }
  const verdict = gate(obs, spec, { localDateKey: today, dailyCode: 'XXXXX', attemptNo: 1 })
  const read = obs.checks.find((c) => c.id === 'steps')
  const good = verdict.status === 'PASS'
  console.log(`  ${good ? 'OK  ' : 'WEAK'}  ${name.padEnd(30)} ${ms}ms  steps=${read?.value ?? '?'} date=${obs.visibleDate ?? '?'} gate=${verdict.status}`)
  if (good) working.push(name)
}

console.log()
if (working.length === 0) {
  console.error('No model read the sample correctly. Do not set a chain; investigate the failures above.')
  process.exit(2)
}
console.log('Working chain, best first. Set it as a function secret / in supabase/functions/.env:\n')
console.log(`GEMINI_MODEL_CHAIN=${working.join(',')}`)
