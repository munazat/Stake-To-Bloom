/**
 * cors.ts — CORS headers for Edge Functions.
 *
 * Measured against the Supabase edge runtime (local stack, CLI v3.1.0): the
 * platform keeps every `Access-Control-*` header a function sets EXCEPT
 * `Access-Control-Allow-Origin`, which it overwrites with `*`. It also answers
 * OPTIONS preflight itself, so a preflight never reaches our handler.
 *
 * Consequence: an origin allowlist CANNOT be enforced through response headers
 * on this platform. `http.ts` therefore enforces it by rejecting the request
 * (`assertAllowedOrigin`) instead of by declining to echo the origin.
 *
 * The forced `*` is not itself a hole. Without
 * `Access-Control-Allow-Credentials` a hostile page cannot read a response to a
 * request it did not authorise, and the Bearer token it would need sits in the
 * victim's localStorage, which cross-origin script cannot reach. The real access
 * control on these functions is the verified JWT plus RLS.
 */

const LOCAL_DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173']

/**
 * Origins allowed to call the API. Defaults to the Vite dev server so a fresh
 * clone works before any env file exists; setting ALLOWED_ORIGINS replaces the
 * defaults entirely, so a deployed project never silently keeps localhost open.
 */
export function allowedOrigins(): string[] {
  const raw = Deno.env.get('ALLOWED_ORIGINS')
  if (!raw || raw.trim() === '') return LOCAL_DEV_ORIGINS
  return raw
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter((o) => o !== '')
}

export function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
  }
}

export function isPreflight(request: Request): boolean {
  return request.method === 'OPTIONS'
}
