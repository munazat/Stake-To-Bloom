/**
 * auth.ts — identity comes from the verified token, never from the request body.
 *
 * This is invariant I2 in the blueprint: an amount or a recipient that a client
 * could choose is an amount a client could steal. So every function resolves the
 * caller by asking GoTrue to validate the bearer token, and writes rows with that
 * id. A body field named `userId` would be ignored even if sent.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { HttpError } from './http.ts'

/**
 * A client that bypasses RLS, for the writes only a function may make (ledger
 * entries, status transitions, settlement rows). Never hand this to a response.
 */
export function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY')
  if (!url || !key) {
    throw new HttpError(
      500,
      'config',
      'Service credentials are missing from the function environment.',
    )
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function bearerToken(request: Request): string {
  const header = request.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1].trim() : ''
}

/**
 * Validate the caller's access token and return the user id it belongs to.
 * Rejects anonymous callers only if `allowGuests` is false; BloomStake guests are
 * real users (blueprint §5), so the default is to accept them.
 */
export async function requireUserId(
  request: Request,
  admin: SupabaseClient,
  options: { allowGuests?: boolean } = {},
): Promise<string> {
  const { allowGuests = true } = options
  const token = bearerToken(request)
  if (!token) {
    throw new HttpError(401, 'unauthorized', 'A signed-in session is required.')
  }
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) {
    throw new HttpError(401, 'unauthorized', 'The session is invalid or has expired.')
  }
  const isGuest = data.user.is_anonymous === true
  if (isGuest && !allowGuests) {
    throw new HttpError(403, 'guest_not_allowed', 'Sign in with an email to continue.')
  }
  return data.user.id
}
