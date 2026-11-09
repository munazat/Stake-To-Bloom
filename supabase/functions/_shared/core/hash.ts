/**
 * hash.ts — canonical JSON + SHA-256, used to freeze a rule spec at funding.
 * rule_hash = sha256(canonicalJson(spec)); the hash is shown on the payout receipt
 * so a user can prove the rule they agreed to is the rule that was applied.
 *
 * Uses the Web Crypto API (globalThis.crypto.subtle) + TextEncoder, which exist
 * unchanged in browsers, Node 24, and Deno — so core stays platform-agnostic.
 */

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep)
  if (value && typeof value === 'object') {
    const src = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(src).sort()) out[key] = sortDeep(src[key])
    return out
  }
  return value
}

/** Deterministic JSON: object keys sorted recursively, array order preserved. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value))
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Stable hash of any rule-spec-shaped value. */
export async function ruleHash(spec: unknown): Promise<string> {
  return sha256Hex(canonicalJson(spec))
}
