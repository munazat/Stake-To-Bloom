/**
 * @bloomstake/core — pure TypeScript, zero I/O.
 *
 * Phase 2 fills this package with the money engine: money.ts (integer cents),
 * dates.ts (IANA-timezone day boundaries), schemas.ts (RuleSpec via zod),
 * rules.ts (settle()) and gate.ts. Everything here must stay side-effect free so
 * it can run identically in the browser, in Vitest, and in Deno Edge Functions
 * (synced into supabase/functions/_shared/core by scripts/sync-core.mjs).
 *
 * NOTE: relative imports inside this package must carry explicit `.ts`
 * extensions — Deno requires it.
 */
export const CORE_VERSION = '0.1.0'
