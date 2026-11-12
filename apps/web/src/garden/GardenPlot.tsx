/**
 * GardenPlot.tsx — one plot, and the decision about how to draw it.
 *
 * The SVG is the floor, not an error state: no WebGL, a lost context, a renderer
 * that throws, or a chunk that fails to download all land on it, and the garden
 * stays fully usable. The status line is real text outside the canvas, so the
 * state of a plot is available to a screen reader whether or not 3D is running.
 */
import { Component, Suspense, lazy, useCallback, useState, type ReactNode } from 'react'
import { gardenStatusText, type GardenStage } from '@bloomstake/core'
import PlantSVG from './PlantSVG.tsx'
import { detectWebGL, isLiteMode, prefersReducedMotion } from './capabilities.ts'

const Scene3D = lazy(() => import('./Scene3D.tsx'))

class RendererBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

export interface GardenPlotProps {
  title: string
  stage: GardenStage
  vitality: number
  passedDays: number
  days: number
  /** Shown under the status, e.g. the stake or "demo player". */
  caption?: string
}

export default function GardenPlot({
  title,
  stage,
  vitality,
  passedDays,
  days,
  caption,
}: GardenPlotProps) {
  const [webglAvailable, setWebglAvailable] = useState(detectWebGL)
  const [reducedMotion] = useState(prefersReducedMotion)
  const [lite] = useState(() => isLiteMode())
  const handleContextLost = useCallback(() => setWebglAvailable(false), [])

  const fallback = (
    <PlantSVG
      stage={stage}
      vitality={vitality}
      reducedMotion={reducedMotion}
      title={`${title}: ${stage}`}
    />
  )

  return (
    <figure className="m-0 overflow-hidden rounded-xl border border-emerald-200 bg-white shadow-sm">
      <div className="meadow aspect-square w-full" data-renderer={webglAvailable ? 'webgl' : 'svg'}>
        {webglAvailable ? (
          <RendererBoundary fallback={fallback}>
            <Suspense fallback={fallback}>
              <Scene3D
                stage={stage}
                vitality={vitality}
                reducedMotion={reducedMotion}
                lite={lite}
                onContextLost={handleContextLost}
              />
            </Suspense>
          </RendererBoundary>
        ) : (
          fallback
        )}
      </div>

      <figcaption className="border-t border-emerald-100 px-4 py-3">
        <span className="block truncate text-sm font-semibold text-slate-800">{title}</span>
        <p aria-live="polite" className="mt-1 text-sm text-emerald-700">
          {gardenStatusText(stage, passedDays, days)}
        </p>
        {caption ? <span className="mt-1 block text-xs text-slate-500">{caption}</span> : null}
      </figcaption>
    </figure>
  )
}
