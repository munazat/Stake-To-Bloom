import { HttpError } from './http.ts'
import { looksHosted } from './paypal.ts'

export async function enforceCounter(
  admin: any,
  input: { scope: 'USER' | 'IP'; value: string; limit: number; now?: Date },
): Promise<void> {
  const salt = Deno.env.get('RATE_LIMIT_SALT') ?? 'bloomstake-local-rate-limit-v1'
  if (looksHosted(Deno.env.get('SUPABASE_URL')) && !Deno.env.get('RATE_LIMIT_SALT')) {
    throw new HttpError(503, 'rate_limit_config', 'The hosted rate limit salt is not configured.')
  }
  const bucket = new Date(input.now ?? new Date())
  bucket.setUTCHours(0, 0, 0, 0)
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${salt}:${input.value}`),
  )
  const keyHash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join(
    '',
  )
  const { data, error } = await admin.rpc('bump_request_counter', {
    p_scope: input.scope,
    p_key_hash: keyHash,
    p_bucket_start: bucket.toISOString(),
    p_limit: input.limit,
  })
  if (error)
    throw new HttpError(
      503,
      'rate_limit_unavailable',
      'Could not check the request limit right now.',
    )
  if (data === 0)
    throw new HttpError(
      429,
      'rate_limited',
      'You have reached today’s request limit. Try again tomorrow.',
    )
}

export function requestIp(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  )
}
