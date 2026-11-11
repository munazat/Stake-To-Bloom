import { serviceClient } from '../_shared/auth.ts'
import { assertMethod, HttpError, json, withCors } from '../_shared/http.ts'

function constantTimeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a),
    right = new TextEncoder().encode(b)
  if (left.length !== right.length) return false
  let diff = 0
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i]
  return diff === 0
}

const handler = async (request: Request) => {
  assertMethod(request, 'POST')
  const expected = Deno.env.get('CRON_SECRET') ?? ''
  const supplied = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!expected || !constantTimeEqual(supplied, expected))
    throw new HttpError(401, 'unauthorized', 'A valid cron secret is required.')
  const admin = serviceClient()
  const now = new Date()
  const { data: expired, error: expiredError } = await admin
    .from('pacts')
    .select('id')
    .eq('status', 'AWAITING_STAKE')
    .lt('created_at', new Date(now.getTime() - 30 * 60_000).toISOString())
  if (expiredError) throw new Error('load stale stake pacts failed')
  let expiredCount = 0
  for (const pact of expired ?? []) {
    const { error } = await admin.rpc('transition_pact', {
      p_pact_id: pact.id,
      p_from: 'AWAITING_STAKE',
      p_to: 'EXPIRED',
    })
    if (!error) expiredCount++
    else if (error.code !== '40001') throw new Error('expire stale pact failed')
  }
  const days = await admin.rpc('close_elapsed_days', { p_now: now.toISOString() })
  if (days.error) throw new Error('close elapsed days failed')
  const counters = await admin
    .from('request_counters')
    .delete()
    .lt('bucket_start', new Date(now.getTime() - 7 * 86_400_000).toISOString())
  if (counters.error) throw new Error('purge stale rate counters failed')
  const candidates = await admin
    .from('pacts')
    .select('id')
    .in('status', ['ACTIVE', 'NEEDS_REVIEW'])
    .not('ends_at', 'is', null)
    .lt('ends_at', new Date(now.getTime() - 60 * 60_000).toISOString())
    .eq('is_demo', false)
    .limit(50)
  if (candidates.error) throw new Error('load settlement candidates failed')
  const base = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY')
  if (!base || !key)
    throw new HttpError(500, 'config', 'Internal function credentials are missing.')
  const invoke = async (name: string, body?: unknown) => {
    const response = await fetch(`${base.replace(/\/$/, '')}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${expected}`,
        apikey: key,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body ?? {}),
    })
    if (!response.ok) throw new Error(`${name} returned ${response.status}`)
    return response.json()
  }
  const results: Array<{ pactId: string; status: string }> = []
  for (const pact of candidates.data ?? []) {
    try {
      results.push({
        pactId: pact.id,
        status: (await invoke('settle-pact', { pact_id: pact.id })).status,
      })
    } catch (error) {
      console.error('cron: settlement deferred', pact.id, error)
      results.push({ pactId: pact.id, status: 'DEFERRED' })
    }
  }
  const payoutPoll = await invoke('settlement-poll')
  const purge = await invoke('demo-proof-purge')
  return json({
    expired: expiredCount,
    daysClosed: days.data ?? 0,
    settlements: results,
    payoutsPolled: payoutPoll.processed ?? 0,
    demoProofsPurged: purge.deleted ?? 0,
    purgeSkipped: purge.skipped ?? null,
  })
}
Deno.serve(withCors(handler))
