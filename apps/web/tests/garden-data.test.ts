import { describe, it, expect } from 'vitest'
import { toPlot } from '../src/lib/garden.ts'

function row(overrides: Partial<Parameters<typeof toPlot>[0]> = {}): Parameters<typeof toPlot>[0] {
  return {
    id: 'pact-1',
    title: 'Walk 6,000 steps',
    status: 'ACTIVE',
    vitality: 0.5,
    stake_cents: 2000,
    currency: 'USD',
    required_passes: 5,
    days: 7,
    funded_at: '2026-11-09T12:00:00Z',
    is_demo: false,
    pact_days: [],
    ...overrides,
  }
}

describe('toPlot', () => {
  it('shows a funded pact with no resolved day as a seed', () => {
    const plot = toPlot(row({ pact_days: [{ day_index: 0, status: 'PENDING' }] }))
    expect(plot.stage).toBe('seed')
    expect(plot.passedDays).toBe(0)
  })

  it('counts only PASSED days', () => {
    const plot = toPlot(
      row({
        pact_days: [
          { day_index: 0, status: 'PASSED' },
          { day_index: 1, status: 'MISSED' },
          { day_index: 2, status: 'UNCLEAR' },
          { day_index: 3, status: 'PASSED' },
          { day_index: 4, status: 'PENDING' },
        ],
      }),
    )
    expect(plot.passedDays).toBe(2)
  })

  it('wilts when the most recent resolved day was missed', () => {
    const plot = toPlot(
      row({
        pact_days: [
          { day_index: 0, status: 'PASSED' },
          { day_index: 1, status: 'MISSED' },
        ],
      }),
    )
    expect(plot.stage).toBe('wilting')
  })

  it('recovers once a later day passes, even though an earlier one was missed', () => {
    const plot = toPlot(
      row({
        vitality: 0.8,
        pact_days: [
          { day_index: 0, status: 'MISSED' },
          { day_index: 1, status: 'PASSED' },
        ],
      }),
    )
    expect(plot.stage).toBe('bloom')
  })

  it('uses the highest day index, not the order the rows arrive in', () => {
    const plot = toPlot(
      row({
        pact_days: [
          { day_index: 3, status: 'MISSED' },
          { day_index: 1, status: 'PASSED' },
        ],
      }),
    )
    expect(plot.stage).toBe('wilting')
  })

  it('ignores pending days when deciding whether the plant is wilting', () => {
    const plot = toPlot(
      row({
        pact_days: [
          { day_index: 0, status: 'MISSED' },
          { day_index: 1, status: 'PENDING' },
        ],
      }),
    )
    expect(plot.stage).toBe('wilting')
  })

  it('treats a missing day list as an unplanted plot rather than crashing', () => {
    expect(toPlot(row({ pact_days: null })).stage).toBe('seed')
  })

  it('lets the settled status override the day rows', () => {
    const days = [{ day_index: 0, status: 'MISSED' as const }]
    expect(toPlot(row({ status: 'SETTLED_FAIL', vitality: 1, pact_days: days })).stage).toBe('withered')
    expect(toPlot(row({ status: 'SETTLED_PASS', vitality: 0.1, pact_days: days })).stage).toBe('bloom')
  })

  it('keeps an unfunded pact as a seed', () => {
    expect(toPlot(row({ status: 'AWAITING_STAKE', funded_at: null, vitality: 0 })).stage).toBe('seed')
  })

  it('passes the money and demo fields through untouched', () => {
    const plot = toPlot(row({ stake_cents: 3500, is_demo: true, required_passes: 6 }))
    expect(plot.stakeCents).toBe(3500)
    expect(plot.isDemo).toBe(true)
    expect(plot.requiredPasses).toBe(6)
    expect(plot.days).toBe(7)
  })

  it('never recomputes vitality — the server value is carried through as-is', () => {
    expect(toPlot(row({ vitality: 0.33, pact_days: [{ day_index: 0, status: 'PASSED' }] })).vitality).toBe(0.33)
  })
})