/**
 * gate.ts — the deterministic proof referee (blueprint §7.6).
 *
 * The AI only PERCEIVES (it fills an Observation). gate() is the only thing that
 * turns observations into a verdict, and it is pure: same inputs -> same verdict.
 * Ordered rules, first match wins. A technical failure (bad schema / model error)
 * yields UNCLEAR, never FAIL (invariant I8: a bug never costs the user money).
 */
import type { Observation, RuleSpec, Verdict } from './schemas.ts'

export interface DayContext {
  /** The pact-local calendar day being verified, YYYY-MM-DD. */
  localDateKey: string
  /** The expected daily code for that day (from dates.dailyCode). */
  dailyCode: string
  /** 1-based attempt counter for this day (max 3 per blueprint §7.3). */
  attemptNo: number
}

export interface GateResult {
  status: Verdict
  reasons: string[]
  injectionFlag: boolean
}

export interface GateOptions {
  /** True when the model call failed or its output did not validate. */
  modelFailed?: boolean
}

// Server-side backstop (blueprint §7.6 step 2) for injections the model misses.
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+|previous\s+)/i,
  /\bsystem\b/i,
  /\bapprove(?:d|val)?\b/i,
  /\bpayout\b/i,
  /send\s*\$/i,
  /you\s+must\b/i,
  /\bas\s+an\s+ai\b/i,
  /\bscore\b/i,
  /\bjson\b/i,
]

function compare(value: number, comparator: '>=' | '<=' | '==', threshold: number): boolean {
  switch (comparator) {
    case '>=':
      return value >= threshold
    case '<=':
      return value <= threshold
    case '==':
      return value === threshold
  }
}

export function gate(
  observation: Observation | null,
  spec: RuleSpec,
  ctx: DayContext,
  opts: GateOptions = {},
): GateResult {
  // 1. Model failed or schema invalid -> UNCLEAR (never FAIL).
  if (opts.modelFailed || !observation) {
    return {
      status: 'UNCLEAR',
      reasons: ["We couldn't read this proof clearly. Please re-upload a sharper image."],
      injectionFlag: false,
    }
  }

  // 2. Prompt-injection: model flag OR server-side regex over the transcript.
  const transcript = observation.transcript ?? ''
  if (observation.injectionDetected || INJECTION_PATTERNS.some((re) => re.test(transcript))) {
    const quote = observation.injectionQuote ? ` ("${observation.injectionQuote}")` : ''
    return {
      status: 'REJECTED',
      reasons: [`Injection attempt blocked${quote}. The AI has no money access; the day stays open.`],
      injectionFlag: true,
    }
  }

  // 3. Proof type must be allowed by the spec.
  if (!spec.proofKinds.includes(observation.imageKind as (typeof spec.proofKinds)[number])) {
    return {
      status: 'REJECTED',
      reasons: [
        `Proof type "${observation.imageKind}" is not accepted for this pact (expected ${spec.proofKinds.join(' or ')}).`,
      ],
      injectionFlag: false,
    }
  }

  // 4. Visible date (screenshots).
  if (spec.requiresVisibleDate) {
    if (!observation.visibleDate) {
      return {
        status: 'UNCLEAR',
        reasons: ["Please show today's date in the screenshot."],
        injectionFlag: false,
      }
    }
    if (observation.visibleDate !== ctx.localDateKey) {
      return {
        status: 'FAIL',
        reasons: [
          `The date shown (${observation.visibleDate}) is not today (${ctx.localDateKey}) — stale or reused screenshot.`,
        ],
        injectionFlag: false,
      }
    }
  }

  // 5. Daily code (photos): UNCLEAR on the first miss, FAIL from the second.
  if (spec.requiresDailyCode && observation.dailyCode !== ctx.dailyCode) {
    if (ctx.attemptNo < 2) {
      return {
        status: 'UNCLEAR',
        reasons: [`Daily code not readable. Today's code is ${ctx.dailyCode} — write it in the photo.`],
        injectionFlag: false,
      }
    }
    return {
      status: 'FAIL',
      reasons: [`The daily code does not match today's (${ctx.dailyCode}).`],
      injectionFlag: false,
    }
  }

  // 6. Tamper suspicion: never forfeit on suspicion alone -> UNCLEAR.
  if ((observation.tamperSignals?.length ?? 0) >= 2) {
    return {
      status: 'UNCLEAR',
      reasons: ['This image shows possible editing. Please upload an unmodified screenshot or photo.'],
      injectionFlag: false,
    }
  }

  // 7. Evaluate every check. A definitive failure beats an unclear one.
  const reasons: string[] = []
  let anyFail = false
  let anyUnclear = false

  for (const check of spec.checks) {
    const obs = observation.checks.find((c) => c.id === check.id)

    if (!obs || !obs.found) {
      anyUnclear = true
      reasons.push(`"${check.description}" was not visible in the proof.`)
      continue
    }

    if (check.kind === 'numeric') {
      const value = typeof obs.value === 'number' ? obs.value : Number.NaN
      if (Number.isNaN(value)) {
        anyUnclear = true
        reasons.push(`Couldn't read a number for "${check.description}".`)
        continue
      }
      if (!compare(value, check.comparator!, check.threshold!)) {
        anyFail = true
        reasons.push(`"${check.description}": saw ${value}, needed ${check.comparator} ${check.threshold}${check.unit ? ` ${check.unit}` : ''}.`)
        continue
      }
      // Anti-hallucination: the number must actually appear in the visible text.
      const evidence = (obs.evidenceText ?? '').replace(/[,\s]/g, '')
      if (!evidence.includes(String(value))) {
        anyUnclear = true
        reasons.push(`The value ${value} for "${check.description}" wasn't backed by visible text.`)
        continue
      }
      reasons.push(`"${check.description}": ${value} ${check.comparator} ${check.threshold} ✓`)
    } else {
      const confidence = obs.confidence ?? 0
      if (obs.value !== true || confidence < (check.minConfidence ?? 0.75)) {
        anyUnclear = true
        reasons.push(`"${check.description}" wasn't confidently satisfied.`)
        continue
      }
      reasons.push(`"${check.description}": confirmed ✓`)
    }
  }

  if (anyFail) return { status: 'FAIL', reasons, injectionFlag: false }
  if (anyUnclear) return { status: 'UNCLEAR', reasons, injectionFlag: false }
  return { status: 'PASS', reasons: reasons.length ? reasons : ['All checks satisfied.'], injectionFlag: false }
}
