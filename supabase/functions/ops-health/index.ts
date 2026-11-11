import { serviceClient } from '../_shared/auth.ts'
import { assertMethod, HttpError, json, withCors } from '../_shared/http.ts'
import { assertSandbox, looksHosted } from '../_shared/paypal.ts'

const handler = async (request: Request) => {
  assertMethod(request, 'POST')
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const cron = Deno.env.get('CRON_SECRET') ?? ''
  const adminSecret = Deno.env.get('ADMIN_SECRET') ?? ''
  if (!token || !(token === cron || token === adminSecret))
    throw new HttpError(401, 'unauthorized', 'A valid operations secret is required.')
  const admin = serviceClient()
  const hosted = looksHosted(Deno.env.get('SUPABASE_URL'))
  const checks: Record<string, string> = {}
  try {
    assertSandbox()
    checks.paypal = 'sandbox configuration valid'
  } catch {
    checks.paypal = 'invalid sandbox configuration'
  }
  const { data: config, error } = await admin
    .from('app_config')
    .select('key,value')
    .in('key', ['payments_enabled', 'settlement_enabled', 'ai_enabled'])
  if (error) checks.config = 'unavailable'
  else checks.config = 'readable'
  const configByKey = new Map((config ?? []).map((row: any) => [row.key, row.value]))
  if (hosted) {
    const required = [
      'CRON_SECRET',
      'ADMIN_SECRET',
      'RATE_LIMIT_SALT',
      'PAYPAL_CLIENT_ID',
      'PAYPAL_CLIENT_SECRET',
      'PAYPAL_WEBHOOK_ID',
      'PAYPAL_CHARITY_EMAIL',
      'ALLOWED_ORIGINS',
    ]
    if (configByKey.get('ai_enabled') === true)
      required.push('GEMINI_API_KEY', 'GEMINI_MODEL_CHAIN')
    const missing = required.filter((name) => !Deno.env.get(name))
    checks.requiredSecrets = missing.length ? `missing: ${missing.join(', ')}` : 'configured'
  } else checks.requiredSecrets = 'local runtime'
  if (Deno.env.get('PAYMENTS_ADAPTER') === 'mock' && hosted)
    checks.paymentAdapter = 'invalid mock-on-hosted configuration'
  else
    checks.paymentAdapter =
      Deno.env.get('PAYMENTS_ADAPTER') === 'mock' ? 'local mock' : 'sandbox adapter'

  const aiEnabled = configByKey.get('ai_enabled') === true
  const mockGemini = Deno.env.get('GEMINI_ADAPTER') === 'mock'
  const key = Deno.env.get('GEMINI_API_KEY')
  const models = (Deno.env.get('GEMINI_MODEL_CHAIN') ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean)
  if (!aiEnabled) checks.gemini = 'disabled by ai_enabled switch'
  else if (mockGemini && !hosted) checks.gemini = 'local mock (model health not exercised)'
  else if (!key || !models.length) checks.gemini = 'model key or model chain missing'
  else {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(models[0])}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Reply with OK.' }] }],
          generationConfig: { maxOutputTokens: 4 },
        }),
      },
    )
    checks.gemini = response.ok
      ? `live model responded (${models[0]})`
      : `model health failed (${response.status})`
  }
  const ok = Object.values(checks).every(
    (value) =>
      !value.includes('invalid') &&
      !value.includes('missing') &&
      !value.includes('unavailable') &&
      !value.includes('failed'),
  )
  return json(
    {
      ok,
      checks,
      switches: Object.fromEntries((config ?? []).map((row: any) => [row.key, row.value])),
    },
    ok ? 200 : 503,
  )
}
Deno.serve(withCors(handler))
