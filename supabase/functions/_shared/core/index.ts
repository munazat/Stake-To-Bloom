/**
 * @bloomstake/core — pure TypeScript, zero I/O, zero network.
 *
 * The money engine and the deterministic referee live here so they run identically
 * in the browser, in Vitest, and in Deno Edge Functions (synced into
 * supabase/functions/_shared/core by scripts/sync-core.mjs).
 *
 * Invariants upheld here: money is integer cents (money.ts); day boundaries are
 * IANA-timezone/DST safe (dates.ts); the RuleSpec is freezable via a canonical hash
 * (hash.ts); settle() is pure and conserves every cent (rules.ts); gate() is the
 * only interpreter of untrusted AI output and never moves money (gate.ts).
 *
 * NOTE: relative imports inside this package carry explicit `.ts` extensions —
 * Deno requires it.
 */
export const CORE_VERSION = '0.2.0'

export * from './money.ts'
export * from './dates.ts'
export * from './hash.ts'
export * from './schemas.ts'
export * from './templates.ts'
export * from './rules.ts'
export * from './gate.ts'
