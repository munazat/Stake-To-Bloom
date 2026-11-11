import { describe, it, expect } from 'vitest'
import {
  MAX_LONG_SIDE,
  fitWithin,
  proofStoragePath,
  sha256OfBlob,
  prepareProof,
  ProofPrepareError,
} from '../src/lib/proof.ts'

describe('fitWithin', () => {
  it('leaves small images alone and never scales up', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(MAX_LONG_SIDE, 100)).toEqual({ width: MAX_LONG_SIDE, height: 100 })
  })

  it('scales the long side down to 1280, keeping the aspect ratio', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1280, height: 960 })
    expect(fitWithin(3000, 4000)).toEqual({ width: 960, height: 1280 })
  })

  it('never produces a zero-sized side', () => {
    const { width, height } = fitWithin(100_000, 3)
    expect(width).toBe(1280)
    expect(height).toBeGreaterThanOrEqual(1)
  })
})

describe('proofStoragePath', () => {
  it('builds <user>/<pact>/<day>-<uuid>.jpg and clamps the day to 0..6', () => {
    expect(proofStoragePath('u', 'p', 2, 'id')).toBe('u/p/2-id.jpg')
    expect(proofStoragePath('u', 'p', 99, 'id')).toBe('u/p/6-id.jpg')
    expect(proofStoragePath('u', 'p', -4, 'id')).toBe('u/p/0-id.jpg')
  })
})

describe('sha256OfBlob', () => {
  it('matches the known SHA-256 of "abc"', async () => {
    // jsdom's Blob has no arrayBuffer(); every real browser does.
    const blob = Object.assign(new Blob(['abc']), {
      arrayBuffer: async () => new TextEncoder().encode('abc').buffer,
    })
    expect(await sha256OfBlob(blob)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})

describe('prepareProof', () => {
  it('refuses HEIC and non-images with a plain message', async () => {
    await expect(prepareProof(new Blob(['x'], { type: 'image/heic' }))).rejects.toBeInstanceOf(
      ProofPrepareError,
    )
    await expect(prepareProof(new Blob(['x'], { type: 'application/pdf' }))).rejects.toThrow(
      /JPG or PNG/,
    )
  })
})
