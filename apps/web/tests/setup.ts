import '@testing-library/jest-dom/vitest'

// jsdom ships no canvas backend and logs "Not implemented" on every getContext
// call. Returning null for the WebGL types is what a browser without a GPU
// actually reports, so the garden tests exercise the SVG path deterministically
// instead of depending on jsdom's error output.
const getContext = HTMLCanvasElement.prototype.getContext
HTMLCanvasElement.prototype.getContext = function patched(this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
  if (kind === 'webgl' || kind === 'webgl2' || kind === 'experimental-webgl') return null
  return (getContext as (...args: unknown[]) => unknown).call(this, kind, ...rest)
} as typeof getContext
