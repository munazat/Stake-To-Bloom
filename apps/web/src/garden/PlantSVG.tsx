/**
 * PlantSVG.tsx — the fallback that is a first-class renderer, not a consolation.
 *
 * It reads the same PlantLook as the WebGL plant, so a device without a GPU sees
 * the same stage, the same proportions and the same colours. Under
 * prefers-reduced-motion the geometry transitions are dropped and only opacity
 * fades, which conveys the change without moving anything.
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
}

export default function PlantSVG({ stage, vitality, reducedMotion = false, title }: PlantSVGProps) {
  const look = plantLook(stage, vitality)
  const height = look.stemHeight * SCALE
  const tipX = 100 + look.stemBend * height * 0.75
  const tipY = SOIL_Y - height * (1 - look.stemBend * 0.55)
  const transition = reducedMotion ? 'opacity 400ms linear' : 'all 700ms ease-out'

  const leaves = Array.from({ length: look.leafCount }, (_, index) => {
    const t = (index + 1) / (look.leafCount + 1)
    const side = index % 2 === 0 ? -1 : 1
    const x = 100 + (tipX - 100) * t
    const y = SOIL_Y + (tipY - SOIL_Y) * t
    const angle = side * (28 + look.leafDroop * 62)
    return (
      <ellipse
        key={index}
        cx={x + side * 13}
        cy={y}
        rx={15}
        ry={6}
        fill={look.leafColor}
        transform={`rotate(${angle} ${x + side * 13} ${y})`}
        style={{ transition }}
      />
    )
  })

  const petals = Array.from({ length: look.petalCount }, (_, index) => {
    const angle = (index / look.petalCount) * Math.PI * 2
    const spread = 4 + look.petalOpen * 12
    return (
      <ellipse
        key={index}
        cx={tipX + Math.cos(angle) * spread}
        cy={tipY + Math.sin(angle) * spread * 0.55}
        rx={4 + look.petalOpen * 5}
        ry={3 + look.petalOpen * 3}
        fill={look.petalColor}
        opacity={look.petalOpen > 0 ? 1 : 0}
        style={{ transition }}
      />
    )
  })

  return (
    <svg
      viewBox="0 0 200 200"
      role="img"
      aria-label={title ?? `${stage} plant`}
      className="h-full w-full"
      data-stage={stage}
    >
      <rect x="34" y={SOIL_Y} width="132" height="26" rx="6" fill="var(--soil, #4b3b2a)" />
      <rect x="34" y={SOIL_Y} width="132" height="7" rx="3" fill="#5f4b36" />

      {stage === 'seed' ? (
        <g style={{ transition }}>
          <ellipse cx="100" cy={SOIL_Y - 3} rx="9" ry="7" fill="#8d6e46" />
          <ellipse cx="100" cy={SOIL_Y - 3} rx="16" ry="11" fill={look.leafColor} opacity="0.18" />
        </g>
      ) : (
        <>
          <path
            d={`M 100 ${SOIL_Y} Q ${100 + look.stemBend * height * 0.2} ${SOIL_Y - height * 0.6} ${tipX} ${tipY}`}
            stroke={look.stemColor}
            strokeWidth={5}
            strokeLinecap="round"
            fill="none"
            style={{ transition }}
          />
          {leaves}
          {petals}
          {look.petalOpen > 0.5 ? <circle cx={tipX} cy={tipY} r="5" fill="#ffd54f" style={{ transition }} /> : null}
        </>
      )}
    </svg>
  )
}