/**
 * garden.ts — the vitality model and the visual stage derived from it.
 *
 * Vitality is owned by the server: it is recomputed whenever a day changes and
 * stored on the pact (blueprint §8.1). The client never computes it. What lives
 * here is the pure arithmetic the server uses, plus the mapping from that number
 * to a visual stage, which the client does need in order to render.
 *
 * Kept in core so the browser, Vitest and the Deno functions agree on where the
 * stage boundaries fall. The column is double precision, so results are rounded
 * to a fixed number of decimals: without that, 0.15 + 0.18 lands on
 * 0.32999999999999996 and a value sitting exactly on a boundary could render as a
 * different stage depending on which code path produced it.
 */
import type { PactStatus } from './schemas.ts'

export const VITALITY_MIN = 0
export const VITALITY_MAX = 1
export const VITALITY_START = 0.15
export const VITALITY_PASS_DELTA = 0.18
export const VITALITY_MISS_DELTA = -0.25

/** Boundary between sprout and growing. */
export const STAGE_SPROUT_MAX = 0.35
/** Boundary between growing and bloom. */
export const STAGE_BLOOM_MIN = 0.7

export type GardenStage = 'seed' | 'sprout' | 'growing' | 'bloom' | 'wilting' | 'withered'

export const GARDEN_STAGES: readonly GardenStage[] = [
  'seed',
  'sprout',
  'growing',
  'bloom',
  'wilting',
  'withered',
]

const PRECISION = 4

export function roundVitality(value: number): number {
  const factor = 10 ** PRECISION
  return Math.round(value * factor) / factor
}

/** Clamp to the range the database CHECK constraint enforces. */
export function clampVitality(value: number): number {
  if (!Number.isFinite(value)) return VITALITY_MIN
  return roundVitality(Math.min(VITALITY_MAX, Math.max(VITALITY_MIN, value)))
}

/**
 * Apply one day's outcome. Server-side only: calling this from the client would
 * let a user water their own garden.
 */
export function applyDayResult(vitality: number, passed: boolean): number {
  return clampVitality(vitality + (passed ? VITALITY_PASS_DELTA : VITALITY_MISS_DELTA))
}

export interface GardenState {
  vitality: number
  status: PactStatus
  /** Whether any proof has been submitted. A funded pact with none is a seed. */
  hasProof: boolean
  /** A miss just landed, or vitality is falling. Comes from the day rows. */
  wilting: boolean
}

/**
 * Derive the visual stage. Settlement outcomes win over the number, because a
 * pact settled as a pass is in bloom even if its final vitality sat below 0.7,
 * and one settled as a fail is withered regardless of how green it still looks.
 */
export function gardenStage(state: GardenState): GardenStage {
  const { status, hasProof, wilting } = state
  const vitality = clampVitality(state.vitality)

  if (status === 'SETTLED_FAIL') return 'withered'
  if (status === 'SETTLED_PASS') return 'bloom'

  // Nothing is planted until the stake is captured. An unfunded or cancelled
  // pact renders the same neutral seed rather than inventing a growth state.
  if (status !== 'ACTIVE' && status !== 'SETTLING' && status !== 'NEEDS_REVIEW') return 'seed'
  if (!hasProof) return 'seed'
  if (wilting) return 'wilting'
  if (vitality >= STAGE_BLOOM_MIN) return 'bloom'
  if (vitality >= STAGE_SPROUT_MAX) return 'growing'
  return 'sprout'
}

/** Human-readable stage name for the visible, aria-live status line. */
export function stageName(stage: GardenStage): string {
  switch (stage) {
    case 'seed':
      return 'Seed'
    case 'sprout':
      return 'Sprout'
    case 'growing':
      return 'Growing'
    case 'bloom':
      return 'Bloom'
    case 'wilting':
      return 'Wilting'
    case 'withered':
      return 'Withered'
  }
}

/**
 * The visible status line, e.g. "Bloom · 4 of 7 days verified". Screen readers
 * announce this instead of trying to describe a WebGL canvas.
 */
export function gardenStatusText(stage: GardenStage, passedDays: number, days: number): string {
  return `${stageName(stage)} · ${passedDays} of ${days} days verified`
}
