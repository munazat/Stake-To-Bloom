import { describe, it, expect } from 'vitest'
import { canonicalJson, sha256Hex, ruleHash } from '../src/hash.ts'
import { RuleSpecSchema } from '../src/schemas.ts'
import { stepsSpec, waterSpec } from '../src/templates.ts'

describe('hash', () => {
  it('canonicalizes JSON with recursively sorted keys, arrays preserved', () => {
    expect(canonicalJson({ a: { d: 1, c: [1, 2] } })).toBe('{"a":{"c":[1,2],"d":1}}')
    expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }))
    // Array order is significant and must NOT be sorted.
    expect(canonicalJson({ list: [3, 1, 2] })).toBe('{"list":[3,1,2]}')
  })

  it('produces the known SHA-256 of "abc"', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('ruleHash is a 64-char hex string, stable across key order', async () => {
    const h1 = await ruleHash({ goalType: 'steps', checks: [{ id: 'steps', threshold: 10000 }] })
    const h2 = await ruleHash({ checks: [{ threshold: 10000, id: 'steps' }], goalType: 'steps' })
    expect(h1).toMatch(/^[0-9a-f]{64}$/)
    expect(h1).toBe(h2)
  })

  it('ruleHash changes when any field changes', async () => {
    const base = await ruleHash({ goalType: 'steps', requiredPasses: 5 })
    const changed = await ruleHash({ goalType: 'steps', requiredPasses: 6 })
    expect(base).not.toBe(changed)
  })
})

describe('frozen Rule Contract hashes', () => {
  // Golden values read back from pacts.rule_hash for rows the pact-create Edge
  // Function wrote on the local stack. They pin cross-runtime parity: the same
  // spec must hash identically in Node/Vitest, in the browser, and in Deno. A
  // failure here means a contract already locked in the database would no longer
  // hash to the value it was stored with. Parsed through RuleSpecSchema first,
  // exactly as the server does.
  it('steps at 12,000 / 5 passes hashes to the stored value', async () => {
    const spec = RuleSpecSchema.parse(stepsSpec({ threshold: 12_000, requiredPasses: 5 }))
    expect(await ruleHash(spec)).toBe(
      '21bc70953a7f87f2600fc38c99c0b22f448696c73e1b393fa19e36a2e18bc123',
    )
  })

  it('steps at the template default hashes to the value the wizard previews', async () => {
    const spec = RuleSpecSchema.parse(stepsSpec())
    expect(await ruleHash(spec)).toBe(
      '40469b9d5599712666c7993f03287ef1896f46c4ce27f03d2b3d5ac458f91300',
    )
  })

  it('water at the template default hashes to the stored value', async () => {
    const spec = RuleSpecSchema.parse(waterSpec())
    expect(await ruleHash(spec)).toBe(
      '8f75f7027ef2ec85fc7178537439fb17b3dd0572f73a684389541518e9b9eda2',
    )
  })
})
