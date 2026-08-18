import { describe, expect, it } from 'vitest'
import { compareVersions, readOwnVersion } from '../src/version.js'

describe('version helpers', () => {
  it('reads a semver from the package manifest', () => {
    expect(readOwnVersion()).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('compares versions major/minor/patch', () => {
    expect(compareVersions('0.4.0', '0.3.9')).toBeGreaterThan(0)
    expect(compareVersions('0.3.2', '0.3.10')).toBeLessThan(0)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('0.3.3-rc.1', '0.3.2')).toBeGreaterThan(0)
  })
})
