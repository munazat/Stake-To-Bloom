/**
 * http.ts — the shape every Edge Function response has, and the only place an
 * exception becomes a status code.
 *
 * Two rules worth knowing before adding a function:
 *   1. Nothing from an unexpected error reaches the client. Internal detail is
 *      logged server-side; the body says only that something failed. Leaking a
 *      Postgres message can disclose schema and, worse, payment state.
 *   2. CORS is applied by the wrapper, not by each handler, so a 500 still
 *      carries the headers a browser needs to *read* the error.
 */
import { ZodError } from 'zod'
import { allowedOrigins, corsHeaders, isPreflight } from './cors.ts'

/** A failure we chose, with a status and a stable machine-readable code. */
export class HttpError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

export function errorBody(code: string, message: string, details?: unknown): Record<string, unknown> {
  return details === undefined ? { error: { code, message } } : { error: { code, message, details } }
}

function toResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return json(errorBody(err.code, err.message, err.details), err.status)
  }
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
    return json(errorBody('invalid_request', 'Request body failed validation.', details), 400)
  }
  // Anything else is a bug or an outage. Log it here, say nothing useful there.
  console.error('unhandled function error:', err)
  return json(errorBody('internal_error', 'The server hit an unexpected error.'), 500)
}

export type Handler = (request: Request) => Response | Promise<Response>

/**
 * Reject a browser caller whose Origin is not on the allowlist.
 *
 * Enforced here rather than via `Access-Control-Allow-Origin` because the
 * Supabase edge runtime overwrites that header with `*` (see cors.ts). A request
 * with no Origin header did not come from a browser, so it is left to the
 * function's own authentication.
 */
export function assertAllowedOrigin(request: Request): void {
  const origin = request.headers.get('origin')
  if (!origin) return
  if (!allowedOrigins().includes(origin.replace(/\/+$/, ''))) {
    throw new HttpError(403, 'origin_not_allowed', 'This origin is not allowed to call the API.')
  }
}

/** Wrap a handler with preflight handling, origin policy, CORS and error mapping. */
export function withCors(handler: Handler): Handler {
  return async (request: Request) => {
    const cors = corsHeaders()
    if (isPreflight(request)) {
      return new Response('ok', { status: 204, headers: cors })
    }
    let response: Response
    try {
      assertAllowedOrigin(request)
      response = await handler(request)
    } catch (err) {
      response = toResponse(err)
    }
    const headers = new Headers(response.headers)
    for (const [key, value] of Object.entries(cors)) headers.set(key, value)
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }
}

/**
 * Largest body we will read, in characters.
 *
 * This is the mitigation for GHSA-mrhx-c7xc-m3w5: zod 3.x can exhaust memory
 * validating oversized constrained collections. We stay on zod 3 on purpose (zod 4
 * is a breaking change we cannot absorb before the deadline), so nothing
 * oversized is allowed to reach a schema in the first place. Real requests here
 * are well under a kilobyte.
 */
const MAX_BODY_CHARS = 16_384

/** Read and JSON-parse a request body, rejecting anything that is not an object. */
export async function readJsonBody(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > MAX_BODY_CHARS) {
    throw new HttpError(413, 'body_too_large', `Request body must be under ${MAX_BODY_CHARS} characters.`)
  }

  const raw = await request.text()
  // Re-checked because Content-Length can be absent or wrong on a chunked body.
  if (raw.length > MAX_BODY_CHARS) {
    throw new HttpError(413, 'body_too_large', `Request body must be under ${MAX_BODY_CHARS} characters.`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body must be valid JSON.')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'invalid_json', 'Request body must be a JSON object.')
  }
  return parsed
}

/** Reject any method other than the ones a function actually implements. */
export function assertMethod(request: Request, ...methods: string[]): void {
  if (!methods.includes(request.method)) {
    throw new HttpError(405, 'method_not_allowed', `${request.method} is not allowed here.`)
  }
}
