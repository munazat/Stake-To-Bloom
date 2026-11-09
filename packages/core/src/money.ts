/**
 * money.ts — all money is an integer number of cents. Never a float.
 * These helpers are the only place currency strings are built or parsed, so
 * amount math stays exact and PayPal-bound strings are derived from integers.
 */

export type Cents = number

/** Validate that a value is a safe integer number of cents. */
export function assertCents(value: number, label = 'amount'): Cents {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new RangeError(`${label} must be an integer number of cents, got ${String(value)}`)
  }
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} is outside the safe integer range for cents`)
  }
  return value
}

/** 2000 -> "20.00". Built from integer math only (never value/100 as a float). */
export function centsToUsdString(cents: number): string {
  assertCents(cents, 'cents')
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const dollars = Math.floor(abs / 100)
  const rem = abs % 100
  return `${sign}${dollars}.${String(rem).padStart(2, '0')}`
}

/** 2000 -> "$20.00" for display. */
export function formatUsd(cents: number): string {
  return `$${centsToUsdString(cents)}`
}

/** "20.00" -> 2000. Rejects anything that is not an exact 2-decimal USD string. */
export function usdStringToCents(value: string): Cents {
  const trimmed = value.trim()
  const m = /^(-?)(\d+)\.(\d{2})$/.exec(trimmed)
  if (!m) {
    throw new RangeError(`Invalid USD string: "${value}" (expected exactly e.g. "20.00")`)
  }
  const sign = m[1] === '-' ? -1 : 1
  const cents = Number(m[2]) * 100 + Number(m[3])
  return assertCents(sign * cents, 'parsed amount')
}

/** Sum integer cents, validating every addend and the total. */
export function sumCents(values: readonly number[]): Cents {
  let total = 0
  for (const v of values) {
    assertCents(v, 'summand')
    total += v
  }
  return assertCents(total, 'sum')
}
