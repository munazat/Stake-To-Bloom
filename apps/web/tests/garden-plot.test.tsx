import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GARDEN_STAGES } from '@bloomstake/core'
import GardenPlot from '../src/garden/GardenPlot.tsx'
import PlantSVG from '../src/garden/PlantSVG.tsx'
import { isLiteMode } from '../src/garden/capabilities.ts'

describe('GardenPlot', () => {
  // jsdom has no WebGL, so this exercises the path a GPU-less device actually takes.
  it('falls back to the SVG when WebGL is unavailable', () => {
    const { container } = render(
      <GardenPlot title="Walk 6,000 steps" stage="bloom" vitality={0.8} passedDays={4} days={7} />,
    )
    expect(container.querySelector('[data-renderer="svg"]')).not.toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('announces the stage and the verified-day count as live text', () => {
    render(<GardenPlot title="Walk" stage="bloom" vitality={0.8} passedDays={4} days={7} />)
    const status = screen.getByText('Bloom · 4 of 7 days verified')
    expect(status).toHaveAttribute('aria-live', 'polite')
  })

  it('keeps the status outside the graphics, so it survives the fallback', () => {
    render(<GardenPlot title="Walk" stage="withered" vitality={0} passedDays={1} days={7} />)
    expect(screen.getByText('Withered · 1 of 7 days verified')).toBeInTheDocument()
  })

  it('shows the caption when one is given', () => {
    render(
      <GardenPlot title="Walk" stage="seed" vitality={0.15} passedDays={0} days={7} caption="$20.00 USD · demo player" />,
    )
    expect(screen.getByText(/demo player/)).toBeInTheDocument()
  })
})

describe('PlantSVG', () => {
  it('renders a labelled image for every stage', () => {
    for (const stage of GARDEN_STAGES) {
      const { unmount } = render(<PlantSVG stage={stage} vitality={0.5} title={`plot: ${stage}`} />)
      expect(screen.getByRole('img', { name: `plot: ${stage}` })).toHaveAttribute('data-stage', stage)
      unmount()
    }
  })

  it('draws a seed instead of a stem before any proof', () => {
    const { container } = render(<PlantSVG stage="seed" vitality={0.15} />)
    expect(container.querySelector('path')).toBeNull()
    expect(container.querySelectorAll('ellipse').length).toBeGreaterThan(0)
  })

  it('draws a stem once the plant is above ground', () => {
    const { container } = render(<PlantSVG stage="growing" vitality={0.5} />)
    expect(container.querySelector('path')).not.toBeNull()
  })

  it('fades rather than moves under reduced motion', () => {
    const { container } = render(<PlantSVG stage="growing" vitality={0.5} reducedMotion />)
    const stem = container.querySelector('path')
    expect(stem?.getAttribute('style')).toContain('opacity')
    expect(stem?.getAttribute('style')).not.toContain('all 700ms')
  })
})

describe('isLiteMode', () => {
  it('drops to lite on a low-core device and stays full on a capable one', () => {
    const original = Object.getOwnPropertyDescriptor(Navigator.prototype, 'hardwareConcurrency')
    const pin = (value: number) =>
      Object.defineProperty(navigator, 'hardwareConcurrency', { value, configurable: true })
    try {
      pin(2)
      expect(isLiteMode('')).toBe(true)
      pin(4)
      expect(isLiteMode('')).toBe(true)
      pin(8)
      expect(isLiteMode('')).toBe(false)
      expect(isLiteMode('?other=1')).toBe(false)
    } finally {
      delete (navigator as { hardwareConcurrency?: number }).hardwareConcurrency
      if (original) Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', original)
    }
  })

  it('lets ?lite=1 override a capable device', () => {
    expect(isLiteMode('?lite=1')).toBe(true)
  })
})