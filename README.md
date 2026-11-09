# BloomStake

> **Sandbox Mode — No Real Money.** BloomStake is a hackathon demo. All payments
> run against the **PayPal Sandbox** only; the app refuses to move money outside
> `api-m.sandbox.paypal.com`.

Put real skin in the game for your daily wellness goals. Lock a stake, upload
daily photo/screenshot proof, and let an **AI vision referee** (which only
*perceives* — never decides money) feed a **deterministic rule engine** that
settles payouts. Your 2.5D garden **blooms** on verified days and **wilts** when
you miss them.

**AI never moves money.** The model extracts observations as data; only `gate()`
interprets them and only `settle()` plans a payout, guarded by strict invariants.

---

## Status

**Phase 1 — monorepo scaffold.** This is an in-progress build for the
[PayPal AI Hackathon](https://paypalaihackathon.devpost.com/). See the phase list
below; the README grows as each phase lands.

## Stack (all free tier)

| Layer | Choice |
| --- | --- |
| Language | TypeScript everywhere |
| Frontend | Vite + React 19 + React Router + TanStack Query + Tailwind CSS v4 |
| Garden | three + @react-three/fiber + drei (procedural, no external assets) + SVG fallback |
| Backend | Supabase (Postgres + RLS, Auth, Storage, Realtime, Deno Edge Functions) |
| Validation | zod (shared between web, core, and functions) |
| AI | Google Gemini (free tier) via a model chain |
| Payments | PayPal REST (Sandbox): Orders v2, Webhooks, Payouts, Refunds |
| Tests | Vitest + fast-check (core), Deno test (functions), Playwright (E2E smoke) |
| Hosting | Cloudflare Pages (`*.pages.dev`), static SPA |

## Repository layout

```
bloomstake/
  apps/web/            Vite + React SPA (static; public/_redirects for SPA routing)
  packages/core/       pure TypeScript: rules.ts (settle), gate.ts, schemas.ts,
                       money.ts, dates.ts  (zod only, no I/O)
  supabase/
    migrations/        numbered .sql (schema, RLS, functions, triggers, storage)
    functions/         Deno Edge Functions + _shared/ (paypal, gemini, guard, core copy)
  scripts/             sync-core.mjs, paypal-smoke.mjs, make-attack-corpus.html
  .github/workflows/   ci.yml, keepalive.yml
```

> **Edge Function bundling pitfall:** functions can only bundle files under
> `supabase/functions`. `scripts/sync-core.mjs` copies `packages/core` into
> `supabase/functions/_shared/core`. Core imports carry explicit `.ts`
> extensions (Deno requires it).

## Local development

```bash
npm install
npm run dev          # start the web SPA (http://localhost:5173)
npm run test         # run unit/property tests across workspaces
npm run typecheck    # tsc --noEmit across workspaces
npm run build        # production build of the web SPA
```

Copy `.env.example` to a local `.env` (never committed) for the web build vars.
Edge Function secrets are set with `supabase secrets set` — never in git.

## Build phases

1. **Monorepo scaffold** ← current
2. `packages/core` money engine (`settle`, `money`, `dates`, `schemas`, property tests)
3. Supabase schema, RLS, migrations, triggers
4. Pact creation flow + Rule Contract (locked `rule_hash`)
5. Living 2.5D garden (React Three Fiber) + SVG fallback
6. AI proof referee (`gemini`, `gate`, injection defence, sample-proof generator)
7. PayPal money-IN (Orders v2 + webhooks + audit feed)
8. PayPal money-OUT (Payouts, settlement guard, refunds, receipt)
9. Judge demo mode + ops hardening (demo-advance, cron, keep-alive, kill switches)
10. Deploy + docs + video + Devpost submission

## Disclosures

- **Sandbox only.** No real money is moved. Simulated pool peers are labelled
  "demo player"; forfeits route to a clearly labelled sandbox charity account.
- **AI privacy.** Demo proof images are generated in-browser. Do not upload
  personal photos. Images are processed by Google's Gemini API under its
  free-tier terms, which may allow review and product improvement.
- **Reuse.** Design patterns (layout, tokens, Gemini-wrapper and rate-limit
  ideas) are informed by the author's earlier *Health Garden* project; **all code
  in this repository was written after 1 Oct 2026.**
- **Legal.** This is a skill-based commitment contract in a sandbox. A real
  launch would require payments/gambling-law review and PayPal policy approval.

## License

MIT — see [LICENSE](./LICENSE).
