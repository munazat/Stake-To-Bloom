/**
 * capabilities.ts — what this device can afford, decided once per mount.
 *
 * Every probe here is allowed to fail: a browser that blocks canvas fingerprinting
 * or runs without a GPU must still get a working garden, so an exception means
 * "no WebGL" rather than a broken page.
 */

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false
}

/** ?lite=1 lets a judge on a slow laptop force the cheap path without a rebuild. */
export function isLiteMode(search: string = window.location.search): boolean {
  if (new URLSearchParams(search).get('lite') === '1') return true
  const cores = navigator.hardwareConcurrency
  return typeof cores === 'number' && cores > 0 && cores <= 4
}

export function detectWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas')
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null
    if (!gl) return false
    // The probe context counts against the browser's live-context budget, and a
    // garden with several plots would exhaust it. Give it back immediately.
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return true
  } catch {
    return false
  }
}