/**
 * dates.ts — timezone-safe day boundaries using IANA zones via Intl.
 *
 * A pact stores UTC instants plus an IANA timezone. "Which day is it?" is always
 * answered in the pact's own zone, never the server's or the client's, and day
 * arithmetic is done on calendar dates (via Date.UTC of the Y/M/D parts) so DST
 * transitions can never shift a day index.
 */

export type Instant = Date | string | number

const MS_PER_DAY = 86_400_000
const isoFormatterCache = new Map<string, Intl.DateTimeFormat>()

function isoFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = isoFormatterCache.get(timeZone)
  if (!f) {
    // en-CA renders as YYYY-MM-DD, which is exactly the ISO local-date key we want.
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    isoFormatterCache.set(timeZone, f)
  }
  return f
}

function toDate(instant: Instant): Date {
  const d = instant instanceof Date ? instant : new Date(instant)
  if (Number.isNaN(d.getTime())) throw new RangeError(`Invalid instant: ${String(instant)}`)
  return d
}

/** The local calendar day (YYYY-MM-DD) of an instant in the given IANA zone. */
export function localDateKey(instant: Instant, timeZone: string): string {
  return isoFormatter(timeZone).format(toDate(instant))
}

function utcMidnightFromKey(key: string): number {
  const [y, m, d] = key.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/**
 * Whole calendar days between the local date of `startsAt` and of `instant`,
 * in the pact zone. Day 0 is the local day the pact started. DST-safe because it
 * compares calendar dates, not elapsed milliseconds.
 */
export function dayIndex(startsAt: Instant, instant: Instant, timeZone: string): number {
  const startKey = localDateKey(startsAt, timeZone)
  const curKey = localDateKey(instant, timeZone)
  return Math.round((utcMidnightFromKey(curKey) - utcMidnightFromKey(startKey)) / MS_PER_DAY)
}

export function isSameLocalDay(a: Instant, b: Instant, timeZone: string): boolean {
  return localDateKey(a, timeZone) === localDateKey(b, timeZone)
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no I, L, O, 0, 1 (avoid ambiguity)

/**
 * Deterministic 5-character daily code for photo proofs (the code a user writes
 * in-frame so a photo can be tied to a specific day). Pure xorshift over an FNV-1a
 * hash — identical in the browser, Node, and Deno (no platform crypto differences).
 */
export function dailyCode(pactId: string, dayIdx: number): string {
  const s = `${pactId}:${dayIdx}`
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  let out = ''
  let x = h === 0 ? 0x9e3779b9 : h
  for (let i = 0; i < 5; i++) {
    out += CODE_ALPHABET[x & 31]
    x ^= x << 13
    x >>>= 0
    x ^= x >>> 17
    x ^= x << 5
    x >>>= 0
  }
  return out
}
