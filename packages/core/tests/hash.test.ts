import { describe, it, expect } from 'vitest'
import { canonicalJson, sha256Hex, ruleHash } from '../src/hash.ts'

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
