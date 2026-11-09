import { describe, it, expect } from 'vitest'
import { localDateKey, dayIndex, isSameLocalDay, dailyCode } from '../src/dates.ts'

describe('dates', () => {
  it('computes the local date key in a zone', () => {
    // 02:00Z is still the previous evening in New York (EST, UTC-5 in November).
    expect(localDateKey('2026-11-09T02:00:00Z', 'America/New_York')).toBe('2026-11-08')
    expect(localDateKey('2026-11-09T02:00:00Z', 'UTC')).toBe('2026-11-09')
    expect(localDateKey('2026-11-09T02:00:00Z', 'Asia/Karachi')).toBe('2026-11-09')
  })

  it('is DST-safe across the US fall-back (Nov 1 2026 is a 25-hour day)', () => {
    const tz = 'America/New_York'
    expect(dayIndex('2026-10-30T12:00:00Z', '2026-11-02T12:00:00Z', tz)).toBe(3)
    // The 25-hour calendar day still advances the index by exactly 1.
    expect(dayIndex('2026-10-31T12:00:00Z', '2026-11-01T12:00:00Z', tz)).toBe(1)
    // Same instant, different zone -> different day index is possible.
    expect(dayIndex('2026-11-09T02:00:00Z', '2026-11-09T02:00:00Z', 'UTC')).toBe(0)
  })

  it('detects the same local day', () => {
    expect(isSameLocalDay('2026-11-09T01:00:00Z', '2026-11-09T03:00:00Z', 'UTC')).toBe(true)
    expect(isSameLocalDay('2026-11-09T23:00:00Z', '2026-11-10T01:00:00Z', 'UTC')).toBe(false)
  })

  it('rejects an invalid instant', () => {
    expect(() => localDateKey('not-a-date', 'UTC')).toThrow()
  })

  it('daily code is deterministic, in-alphabet, and day/pact specific', () => {
    const a = dailyCode('pact-123', 0)
    expect(a).toBe(dailyCode('pact-123', 0))
    expect(a).toMatch(/^[A-HJ-NP-Z2-9]{5}$/)
    expect(a).not.toBe(dailyCode('pact-123', 1))
    expect(a).not.toBe(dailyCode('pact-124', 0))
  })
})
