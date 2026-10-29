import { describe, expect, it } from 'vitest'
import { benchPath, isSoftwareRenderer, summarize } from './benchmark'

describe('drawing speed test (0.24)', () => {
  it('plays the same stroke every time, inside the picture', () => {
    const a = benchPath(4000, 4000, 150)
    expect(a).toEqual(benchPath(4000, 4000, 150))
    expect(a).toHaveLength(150)
    for (const p of a.flat()) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(4000)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeLessThanOrEqual(4000)
      expect(p.pressure).toBeGreaterThanOrEqual(0.5)
      expect(p.pressure).toBeLessThanOrEqual(1)
    }
  })

  it('sums up move times', () => {
    const r = summarize('x', [10, 20, 30, 40])
    expect(r.avgMs).toBe(25)
    expect(r.p95Ms).toBe(40)
    expect(r.slow).toBe(3)
    expect(r.moves).toBe(4)
  })

  it('spots drawing without the graphics card', () => {
    expect(isSoftwareRenderer('llvmpipe (LLVM 19.1.7, 256 bits)')).toBe(true)
    expect(isSoftwareRenderer('Google SwiftShader')).toBe(true)
    expect(isSoftwareRenderer('AMD Radeon RX 7800 XT (radeonsi, navi32, LLVM 19.1.7, DRM 3.61)')).toBe(false)
    expect(isSoftwareRenderer('NVIDIA GeForce RTX 4070/PCIe/SSE2')).toBe(false)
  })
})
