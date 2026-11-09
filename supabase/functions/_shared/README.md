# Shared Edge Function code

Everything under `supabase/functions/_shared/` is importable by any Edge Function.

`core/` is **not hand-written**. It is a synced copy of `packages/core/src`,
produced by `npm run sync-core` (`scripts/sync-core.mjs`). Edge Functions can
only bundle files that live under `supabase/functions/`, so the copy is
committed rather than generated at deploy time. Run `sync-core` before
deploying whenever `packages/core` changes.

Still to come: `paypal.ts`, `gemini.ts`, `guard.ts`, `prompt.ts`.

## What is here now

| Module | Purpose |
| --- | --- |
| `cors.ts` | Origin allowlist (`ALLOWED_ORIGINS`) and the CORS header set. |
| `http.ts` | `withCors` wrapper: preflight, origin policy, error → status mapping, JSON envelope. |
| `auth.ts` | `serviceClient()` (bypasses RLS) and `requireUserId()` (identity from the verified token). |

## CORS on the Supabase edge runtime — measured, not assumed

The runtime keeps every `Access-Control-*` header a function sets **except**
`Access-Control-Allow-Origin`, which it overwrites with `*`. It also answers
`OPTIONS` preflight itself, so a preflight never reaches our handler.

So an origin allowlist cannot be enforced through response headers here.
`http.ts` enforces it by **rejecting the request** instead: a browser caller
whose `Origin` is not allowed gets `403 origin_not_allowed`. Requests with no
`Origin` header are not browser calls (curl, server-to-server, PayPal webhooks)
and are left to the function's own authentication.

The forced `*` is not itself a hole: without
`Access-Control-Allow-Credentials` a hostile page cannot read a response to a
request it did not authorise, and the Bearer token it would need lives in the
victim's `localStorage`, which cross-origin script cannot reach.

## Declaring a function in config.toml

The CLI refuses to start if `supabase/config.toml` names a function that has no
`index.ts` on disk:

```
failed to read file: open supabase/functions/<name>/index.ts: no such file or directory
```

So add the `[functions.<name>]` block in the same change that adds the
directory, never ahead of it.

## Note for the future PayPal webhook

PayPal cannot send a user JWT, so `paypal-webhook` needs `verify_jwt = false` in
`config.toml` and must verify the PayPal transmission signature itself. Every
other function keeps JWT verification on.
