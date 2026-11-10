/**
 * Plant3D.tsx — the procedural plant. No model files, so no licence risk.
 *
 * Geometry is built once at PLANT_REFERENCE_HEIGHT and the whole plant is scaled
 * to the target height, rather than rebuilding a TubeGeometry every frame. Only
 * leaf count and stem bend change the mesh, and those change on stage transitions,
 * not on every vitality tick.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { GardenStage } from '@bloomstake/core'
import { PLANT_REFERENCE_HEIGHT, plantLook } from './visuals.ts'

export interface Plant3DProps {
  stage: GardenStage
  vitality: number
  reducedMotion: boolean
  lite: boolean
}

export default function Plant3D({ stage, vitality, reducedMotion, lite }: Plant3DProps) {
  const look = plantLook(stage, vitality)
  const group = useRef<THREE.Group>(null)

  // One material per part, shared by every leaf and petal: they must change colour
  // together, and a material instance is what useFrame can interpolate. Seeded with
  // the current colours so mounting does not flash white; useFrame owns them after.
  const materials = useMemo(
    () => ({
      stem: new THREE.MeshStandardMaterial({ color: look.stemColor, roughness: 0.75 }),
      leaf: new THREE.MeshStandardMaterial({ color: look.leafColor, roughness: 0.65 }),
      petal: new THREE.MeshStandardMaterial({ color: look.petalColor, roughness: 0.5 }),
    }),
    [],
  )

  useEffect(() => {
    return () => {
      materials.stem.dispose()
      materials.leaf.dispose()
      materials.petal.dispose()
    }
  }, [materials])

  const bend = Math.round(look.stemBend * 10) / 10
  const stemGeometry = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(bend * 0.15, PLANT_REFERENCE_HEIGHT * 0.35, 0),
      new THREE.Vector3(bend * 0.55, PLANT_REFERENCE_HEIGHT * (0.7 - bend * 0.15), 0),
      new THREE.Vector3(bend * 1.1, PLANT_REFERENCE_HEIGHT * (1 - bend * 0.55), 0),
    ])
    return new THREE.TubeGeometry(curve, lite ? 10 : 20, 0.045, lite ? 4 : 6, false)
  }, [bend, lite])

  useEffect(() => () => stemGeometry.dispose(), [stemGeometry])

  const tip = useMemo(
    () => new THREE.Vector3(bend * 1.1, PLANT_REFERENCE_HEIGHT * (1 - bend * 0.55), 0),
    [bend],
  )

  const leaves = useMemo(
    () =>
      Array.from({ length: look.leafCount }, (_, index) => {
        const t = (index + 1) / (look.leafCount + 1)
        const side = index % 2 === 0 ? -1 : 1
        return {
          position: [bend * 1.1 * t * t, PLANT_REFERENCE_HEIGHT * (1 - bend * 0.55) * t, 0] as const,
          side,
        }
      }),
    [look.leafCount, bend],
  )

  const targets = useMemo(
    () => ({
      scale: look.stemHeight / PLANT_REFERENCE_HEIGHT,
      stem: new THREE.Color(look.stemColor),
      leaf: new THREE.Color(look.leafColor),
      petal: new THREE.Color(look.petalColor),
    }),
    [look.stemHeight, look.stemColor, look.leafColor, look.petalColor],
  )

  useFrame((state, delta) => {
    // Reduced motion gets the final value on the single invalidated frame, so the
    // plant still updates but nothing travels across the screen.
    const alpha = reducedMotion ? 1 : 1 - Math.exp(-delta * 4)
    const node = group.current
    if (node) {
      const next = THREE.MathUtils.lerp(node.scale.x, targets.scale, alpha)
      node.scale.setScalar(next)
      node.rotation.z =
        reducedMotion || lite ? 0 : Math.sin(state.clock.elapsedTime * 1.1) * 0.035
    }
    materials.stem.color.lerp(targets.stem, alpha)
    materials.leaf.color.lerp(targets.leaf, alpha)
    materials.petal.color.lerp(targets.petal, alpha)
  })

  const petalSpread = 0.06 + look.petalOpen * 0.22

  return (
    <group>
      {stage === 'seed' ? (
        <group position={[0, 0.06, 0]}>
          <mesh>
            <sphereGeometry args={[0.13, lite ? 8 : 14, lite ? 6 : 10]} />
            <meshStandardMaterial color="#8d6e46" roughness={0.8} />
          </mesh>
          <mesh>
            <sphereGeometry args={[0.22, 10, 8]} />
            <meshBasicMaterial color={look.leafColor} transparent opacity={0.16} />
          </mesh>
        </group>
      ) : null}

      <group ref={group} scale={0.001}>
        <mesh geometry={stemGeometry} material={materials.stem} />

        {leaves.map((leaf, index) => (
          <mesh
            key={index}
            position={[leaf.position[0] + leaf.side * 0.19, leaf.position[1], 0]}
            rotation={[0, 0, leaf.side * (0.5 + look.leafDroop * 1.1)]}
            scale={[1, 0.3, 0.62]}
            material={materials.leaf}
          >
            <sphereGeometry args={[0.22, lite ? 6 : 12, lite ? 4 : 8]} />
          </mesh>
        ))}

        {look.petalOpen > 0
          ? Array.from({ length: look.petalCount }, (_, index) => {
              const angle = (index / look.petalCount) * Math.PI * 2
              return (
                <mesh
                  key={index}
                  position={[
                    tip.x + Math.cos(angle) * petalSpread,
                    tip.y + 0.04,
                    tip.z + Math.sin(angle) * petalSpread,
                  ]}
                  rotation={[Math.cos(angle) * 0.9 * look.petalOpen, 0, -Math.sin(angle) * 0.9 * look.petalOpen]}
                  scale={0.35 + look.petalOpen * 0.65}
                  material={materials.petal}
                >
                  <coneGeometry args={[0.11, 0.3, lite ? 4 : 7]} />
                </mesh>
              )
            })
          : null}

        {look.petalOpen > 0.5 ? (
          <mesh position={[tip.x, tip.y + 0.05, tip.z]}>
            <sphereGeometry args={[0.09, 10, 8]} />
            <meshStandardMaterial color="#ffd54f" emissive="#ffca28" emissiveIntensity={0.3} />
          </mesh>
        ) : null}
      </group>
    </group>
  )
}