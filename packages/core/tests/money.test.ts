import { describe, it, expect } from 'vitest'
import {
  centsToUsdString,
  usdStringToCents,
  formatUsd,
  sumCents,
  assertCents,
} from '../src/money.ts'

describe('money', () => {
  it('formats cents to a USD string using integer math', () => {
    expect(centsToUsdString(2000)).toBe('20.00')
    expect(centsToUsdString(5)).toBe('0.05')
    expect(centsToUsdString(0)).toBe('0.00')
    expect(centsToUsdString(100482)).toBe('1004.82')
    expect(centsToUsdString(-1234)).toBe('-12.34')
  })

  it('parses exact 2-decimal USD strings', () => {
    expect(usdStringToCents('20.00')).toBe(2000)
    expect(usdStringToCents('0.05')).toBe(5)
    expect(usdStringToCents('1004.82')).toBe(100482)
  })

  it('rejects malformed USD strings', () => {
    for (const bad of ['20', '20.0', '20.000', '$20.00', 'abc', '']) {
      expect(() => usdStringToCents(bad)).toThrow()
    }
  })

  it('rejects non-integer cents', () => {
    expect(() => assertCents(20.5)).toThrow()
    expect(() => centsToUsdString(1.5)).toThrow()
    expect(() => sumCents([1, 2.5])).toThrow()
  })

  it('round-trips and sums', () => {
    for (const c of [1, 99, 100, 5000, 123456]) {
      expect(usdStringToCents(centsToUsdString(c))).toBe(c)
    }
    expect(sumCents([500, 1500, 2000])).toBe(4000)
    expect(sumCents([])).toBe(0)
    expect(formatUsd(4000)).toBe('$40.00')
  })
})
