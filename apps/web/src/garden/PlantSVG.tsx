/**
 * PlantSVG.tsx — the illustrated plant, and the fallback that is a first-class
 * renderer rather than a consolation.
 *
 * It reads the same PlantLook as the WebGL plant, so a device without a GPU sees
 * the same stage, the same proportions and the same colours. Under
 * prefers-reduced-motion the geometry transitions are dropped and only opacity
 * fades, which conveys the change without moving anything.
 *
 * Draw order matters to the tests and to the eye: ground shadow, then the stem
 * (the first <path>), then leaves, then the flower or bud on top.
 */
import type { GardenStage } from '@bloomstake/core'
import { PLANT_REFERENCE_HEIGHT, plantLook } from './visuals.ts'

const SOIL_Y = 158
const SCALE = 78 / PLANT_REFERENCE_HEIGHT

export interface PlantSVGProps {
  stage: GardenStage
  vitality: number
  reducedMotion?: boolean
  title?: string
  /** Skip the soil pad when the plant is drawn over a field illustration. */
  bare?: boolean
}

const LEAF = 'M0 0 C 6 -9 22 -10 32 0 C 22 8 6 7 0 0 Z'
const PETAL = 'M0 0 C -6 -8 -6 -19 0 -25 C 6 -19 6 -8 0 0 Z'

export default function PlantSVG({
  stage,
  vitality,
  reducedMotion = false,
  title,
  bare = false,
}: PlantSVGProps) {
  const look = plantLook(stage, vitality)
  const height = look.stemHeight * SCALE
  const bend = look.stemBend
  const controlX = 100 + bend * height * 0.2
  const controlY = SOIL_Y - height * 0.6
  const tipX = 100 + bend * height * 0.75
  const tipY = SOIL_Y - height * (1 - bend * 0.55)
  const transition = reducedMotion ? 'opacity 400ms linear' : 'all 700ms ease-out'
  const sizeFactor = 0.55 + 0.45 * Math.min(1, look.stemHeight / 1.2)

  /** A point on the stem's curve, so leaves sit on the plant rather than beside it. */
  const onStem = (t: number) => ({
    x: (1 - t) * (1 - t) * 100 + 2 * (1 - t) * t * controlX + t * t * tipX,
    y: (1 - t) * (1 - t) * SOIL_Y + 2 * (1 - t) * t * controlY + t * t * tipY,
  })

  const leaves = Array.from({ length: look.leafCount }, (_, index) => {
    const t = 0.22 + (0.62 * index) / Math.max(1, look.leafCount - 1)
    const side = index % 2 === 0 ? -1 : 1
    const { x, y } = onStem(t)
    const scale = sizeFactor * (1.05 - 0.4 * t)
    const lift = 40 - look.leafDroop * 95
    return (
      <g
        key={index}
        transform={`translate(${x} ${y}) scale(${side * scale} ${scale}) rotate(${-lift})`}
        style={{ transition }}
      >
        <path d={LEAF} fill={look.leafColor} />
        <path d={LEAF} fill="#ffffff" opacity="0.16" transform="scale(1 0.5)" />
        <path d="M2 0 L 27 0" stroke="#ffffff" strokeWidth="1.2" opacity="0.4" fill="none" />
      </g>
    )
  })

  const rings = look.petalCount
  const flower =
    look.petalOpen > 0.5 ? (
      <g transform={`translate(${tipX} ${tipY})`} style={{ transition }}>
        {Array.from({ length: rings }, (_, i) => (
          <path
            key={`o${i}`}
            d={PETAL}
            fill={look.petalColor}
            transform={`rotate(${(i * 360) / rings}) scale(0.62)`}
          />
        ))}
        {Array.from({ length: rings }, (_, i) => (
          <path
            key={`i${i}`}
            d={PETAL}
            fill="#ffe27a"
            opacity="0.9"
            transform={`rotate(${(i * 360) / rings + 180 / rings}) scale(0.42)`}
          />
        ))}
        <circle r="5.5" fill="#7a4a1c" />
        <circle r="3.2" fill="#a8672a" />
      </g>
    ) : look.petalCount > 0 && stage !== 'withered' ? (
      // A closed bud: it has not opened yet, or the plant is too tired to.
      <g
        transform={`translate(${tipX} ${tipY}) rotate(${stage === 'wilting' ? 55 : 0})`}
        style={{ transition }}
      >
        <path d="M0 2 C -6 -2 -5 -11 0 -14 C 5 -11 6 -2 0 2 Z" fill={look.petalColor} />
        <path d="M0 2 C -3 -3 -3 -9 0 -12 C 3 -9 3 -3 0 2 Z" fill="#ffffff" opacity="0.22" />
      </g>
    ) : null

  return (
    <svg
      viewBox="0 0 200 200"
      role="img"
      aria-label={title ?? `${stage} plant`}
      className="h-full w-full"
      data-stage={stage}
    >
      {bare ? null : (
        <>
          <rect x="34" y={SOIL_Y} width="132" height="26" rx="6" fill="var(--soil, #4b3b2a)" />
          <rect x="34" y={SOIL_Y} width="132" height="7" rx="3" fill="#5f4b36" />
        </>
      )}
      <ellipse cx="100" cy={SOIL_Y + 2} rx="30" ry="7" fill="#000000" opacity="0.25" />
      <ellipse cx="100" cy={SOIL_Y} rx="19" ry="5.5" fill="#5a432d" />
      <ellipse cx="100" cy={SOIL_Y - 1.5} rx="13" ry="3.2" fill="#7a5c3d" opacity="0.7" />

      {stage === 'seed' ? (
        <g style={{ transition }}>
          <ellipse cx="100" cy={SOIL_Y - 5} rx="15" ry="10" fill={look.leafColor} opacity="0.2" />
          <ellipse cx="100" cy={SOIL_Y - 4} rx="8" ry="6" fill="#9a7748" />
          <ellipse cx="98" cy={SOIL_Y - 6} rx="3" ry="1.8" fill="#c9a76c" opacity="0.8" />
        </g>
      ) : (
        <>
          <path
            d={`M 100 ${SOIL_Y} Q ${controlX} ${controlY} ${tipX} ${tipY}`}
            stroke={look.stemColor}
            strokeWidth={6}
            strokeLinecap="round"
            fill="none"
            style={{ transition }}
          />
          {leaves}
          {flower}
        </>
      )}
    </svg>
  )
}
