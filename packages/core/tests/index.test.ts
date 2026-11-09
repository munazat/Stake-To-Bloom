import { describe, it, expect } from 'vitest'
import { CORE_VERSION } from '../src/index.ts'

describe('@bloomstake/core scaffold', () => {
  it('exposes a semver version', () => {
    expect(CORE_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
