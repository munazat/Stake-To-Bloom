/**
 * Scene3D.tsx — the isometric plot. Loaded lazily: three plus the renderer is by
 * far the heaviest thing in the app and the landing page must never pay for it.
 *
 * Everything here is procedural geometry. The orthographic camera at [8,8,8]
 * looking at the origin is what produces the 2.5D look without any perspective
 * distortion, so plots stay comparable side by side.
 */
import { useEffect, useMemo } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { GardenStage } from '@bloomstake/core'
import Plant3D from './Plant3D.tsx'
import { daylightColor, moodIntensity } from './visuals.ts'

export interface Scene3DProps {
  stage: GardenStage
  vitality: number
  reducedMotion: boolean
  lite: boolean
  onContextLost: () => void
}

/**
 * A lost context is permanent for that canvas — the driver will not hand it back.
 * Telling the parent lets it swap in the SVG for the rest of the session instead
 * of leaving a frozen or blank square where the plant was.
 */
function ContextLossWatcher({ onContextLost }: { onContextLost: () => void }) {
  const gl = useThree((state) => state.gl)
  useEffect(() => {
    const canvas = gl.domElement
    const handler = (event: Event) => {
      event.preventDefault()
      onContextLost()
    }
    canvas.addEventListener('webglcontextlost', handler)
    return () => canvas.removeEventListener('webglcontextlost', handler)
  }, [gl, onContextLost])
  return null
}

function Terrain({ lite }: { lite: boolean }) {
  const rocks = useMemo(
    () => [
      { position: [-0.85, 0.06, 0.7] as const, scale: 0.14 },
      { position: [0.88, 0.05, -0.62] as const, scale: 0.11 },
      { position: [0.7, 0.05, 0.85] as const, scale: 0.09 },
    ],
    [],
  )

  return (
    <group>
      <mesh position={[0, -0.3, 0]}>
        <boxGeometry args={[2.2, 0.6, 2.2]} />
        <meshStandardMaterial color="#4b3b2a" roughness={1} />
      </mesh>
      <mesh position={[0, 0.005, 0]}>
        <boxGeometry args={[2.2, 0.03, 2.2]} />
        <meshStandardMaterial color="#5f4b36" roughness={1} />
      </mesh>

      {[-1.1, 1.1].map((offset) => (
        <mesh key={offset} position={[offset, -0.22, 0]}>
          <boxGeometry args={[0.32, 0.45, 2.5]} />
          <meshStandardMaterial color="#6b9b4a" roughness={0.95} />
        </mesh>
      ))}

      {lite
        ? null
        : rocks.map((rock, index) => (
            <mesh key={index} position={[rock.position[0], rock.position[1], rock.position[2]]} scale={rock.scale}>
              <dodecahedronGeometry args={[1, 0]} />
              <meshStandardMaterial color="#9e9e93" roughness={0.9} />
            </mesh>
          ))}

      {[-0.98, -0.33, 0.33, 0.98].map((x) => (
        <mesh key={x} position={[x, 0.22, -1.18]}>
          <boxGeometry args={[0.08, 0.5, 0.08]} />
          <meshStandardMaterial color="#a1887f" roughness={0.9} />
        </mesh>
      ))}
      <mesh position={[0, 0.32, -1.18]}>
        <boxGeometry args={[2.1, 0.06, 0.05]} />
        <meshStandardMaterial color="#a1887f" roughness={0.9} />
      </mesh>
    </group>
  )
}

export default function Scene3D({ stage, vitality, reducedMotion, lite, onContextLost }: Scene3DProps) {
  const lightColor = useMemo(() => daylightColor(new Date().getHours()), [])

  return (
    <Canvas
      orthographic
      camera={{ position: [8, 8, 8], zoom: 78 }}
      dpr={[1, 1.75]}
      shadows={false}
      frameloop={reducedMotion ? 'demand' : 'always'}
      gl={{ antialias: !lite, powerPreference: 'low-power' }}
      onCreated={({ camera, gl }) => {
        camera.lookAt(0, 0.6, 0)
        gl.setClearColor(new THREE.Color('#eef7ee'), 1)
      }}
    >
      <ContextLossWatcher onContextLost={onContextLost} />
      <ambientLight intensity={0.75} />
      <directionalLight position={[5, 8, 4]} intensity={moodIntensity(stage)} color={lightColor} />
      <Terrain lite={lite} />
      <Plant3D stage={stage} vitality={vitality} reducedMotion={reducedMotion} lite={lite} />
    </Canvas>
  )
}