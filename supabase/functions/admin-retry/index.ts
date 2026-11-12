import { serviceClient } from '../_shared/auth.ts'
import { assertMethod, HttpError, json, readJsonBody, secretMatches, withCors } from '../_shared/http.ts'
import { z } from 'zod'

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('payouts') }),
  z.object({ action: z.literal('settle'), pact_id: z.string().uuid() }),
])
const handler = async (request: Request) => {
  assertMethod(request, 'POST')
  const expected = Deno.env.get('ADMIN_SECRET') ?? ''
  const supplied = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!secretMatches(supplied, expected))
    throw new HttpError(401, 'unauthorized', 'A valid admin secret is required.')
  const body = Body.parse(await readJsonBody(request))
  const admin = serviceClient()
  const base = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY')
  if (!base || !key)
    throw new HttpError(500, 'config', 'Internal function credentials are missing.')
  const name = body.action === 'payouts' ? 'settlement-poll' : 'settle-pact'
  const secret = Deno.env.get('CRON_SECRET') ?? ''
  if (!secret) throw new HttpError(503, 'config', 'CRON_SECRET is not configured.')
  const response = await fetch(`${base.replace(/\/$/, '')}/functions/v1/${name}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}`, apikey: key, 'content-type': 'application/json' },
    body: JSON.stringify(body.action === 'settle' ? { pact_id: body.pact_id } : {}),
  })
  const result = await response.json().catch(() => null)
  if (!response.ok)
    throw new HttpError(response.status, 'retry_failed', 'The retry did not complete.', result)
  return json({ ok: true, result })
}
Deno.serve(withCors(handler))
