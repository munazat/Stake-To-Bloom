/**
 * visuals.ts — one description of what the plant looks like, two renderers.
 *
 * The WebGL scene and the SVG fallback must show the same plant for the same
 * (stage, vitality). Deriving colours and proportions in each renderer separately
 * is how they quietly drift, so both read this instead. Colours come back as hex
 * because CSS wants a string and three wants a Color; hsl() in one and setHSL()
 * in the other would use different units for the same number.
 */
import { STAGE_BLOOM_MIN, STAGE_SPROUT_MAX, clampVitality, type GardenStage } from '@bloomstake/core'

export interface PlantLook {
  /** Stem height in world units. Zero means there is nothing above the soil. */
  stemHeight: number
  /** 0 is upright, 1 is collapsed onto the soil. */
  stemBend: number
  leafCount: number
  /** 0 is held out horizontally, 1 hangs straight down. */
  leafDroop: number
  /** 0 is a closed bud, 1 is a fully open flower. */
  petalOpen: number
  petalCount: number
  stemColor: string
  leafColor: string
  petalColor: string
}

/** Reference height the procedural geometry is built at; renderers scale to it. */
export const PLANT_REFERENCE_HEIGHT = 1.5

function hslHex(hue: number, saturation: number, lightness: number): string {
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation
  const hp = (((hue % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  const [r, g, b] =
    hp < 1 ? [c, x, 0]
    : hp < 2 ? [x, c, 0]
    : hp < 3 ? [0, c, x]
    : hp < 4 ? [0, x, c]
    : hp < 5 ? [x, 0, c]
    : [c, 0, x]
  const m = lightness - c / 2
  const channel = (value: number) =>
    Math.round((value + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${channel(r!)}${channel(g!)}${channel(b!)}`
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * Math.min(1, Math.max(0, t))
}

/** Continuous growth so vitality inside a band still moves the plant. */
function heightForVitality(vitality: number): number {
  if (vitality < STAGE_SPROUT_MAX) {
    return lerp(0.3, 0.65, vitality / STAGE_SPROUT_MAX)
  }
  if (vitality < STAGE_BLOOM_MIN) {
    return lerp(0.65, 1.4, (vitality - STAGE_SPROUT_MAX) / (STAGE_BLOOM_MIN - STAGE_SPROUT_MAX))
  }
  return lerp(1.4, PLANT_REFERENCE_HEIGHT, (vitality - STAGE_BLOOM_MIN) / (1 - STAGE_BLOOM_MIN))
}

export function plantLook(stage: GardenStage, vitality: number): PlantLook {
  const v = clampVitality(vitality)

  if (stage === 'seed') {
    return {
      stemHeight: 0,
      stemBend: 0,
      leafCount: 0,
      leafDroop: 0,
      petalOpen: 0,
      petalCount: 0,
      stemColor: hslHex(120, 0.4, 0.35),
      leafColor: hslHex(120, 0.45, 0.42),
      petalColor: hslHex(330, 0.7, 0.72),
    }
  }

  if (stage === 'withered') {
    return {
      stemHeight: 0.7,
      stemBend: 1,
      leafCount: 2,
      leafDroop: 1,
      petalOpen: 0,
      petalCount: 0,
      stemColor: hslHex(28, 0.3, 0.3),
      leafColor: hslHex(30, 0.32, 0.34),
      petalColor: hslHex(30, 0.25, 0.4),
    }
  }

  const wilting = stage === 'wilting'
  const blooming = stage === 'bloom'
  const growth = (v - STAGE_SPROUT_MAX) / (STAGE_BLOOM_MIN - STAGE_SPROUT_MAX)
  // A settled pass blooms regardless of the vitality it ended on, so its height
  // must not be scaled by a number that no longer describes the outcome.
  const heightVitality = blooming ? Math.max(v, STAGE_BLOOM_MIN) : v

  return {
    stemHeight: heightForVitality(heightVitality),
    stemBend: wilting ? 0.35 : 0,
    leafCount: blooming ? 6 : v < STAGE_SPROUT_MAX ? 2 : 4 + Math.round(Math.min(1, growth) * 2),
    leafDroop: wilting ? 0.6 : 0.08,
    petalOpen: blooming ? 1 : wilting ? 0.05 : v >= STAGE_SPROUT_MAX ? 0.18 : 0,
    petalCount: blooming ? 8 : 5,
    stemColor: hslHex(wilting ? 60 : 120, wilting ? 0.35 : 0.4, wilting ? 0.36 : 0.32),
    leafColor: hslHex(wilting ? 48 : 122, wilting ? 0.45 : 0.5, wilting ? 0.45 : 0.4),
    petalColor: hslHex(wilting ? 45 : 330, wilting ? 0.4 : 0.72, wilting ? 0.55 : 0.72),
  }
}

/**
 * Directional light colour from the visitor's own clock, so the garden looks like
 * their afternoon rather than a fixed studio. Night stays legible — this is mood,
 * not a visibility setting.
 */
export function daylightColor(hour: number): string {
  if (hour < 6 || hour >= 20) return hslHex(225, 0.35, 0.62)
  if (hour < 9) return hslHex(28, 0.65, 0.7)
  if (hour >= 17) return hslHex(22, 0.6, 0.68)
  return hslHex(48, 0.25, 0.95)
}

/** Wilting reads as overcast; everything else keeps the sun. */
export function moodIntensity(stage: GardenStage): number {
  if (stage === 'wilting' || stage === 'withered') return 0.55
  if (stage === 'bloom') return 1.35
  return 1
}