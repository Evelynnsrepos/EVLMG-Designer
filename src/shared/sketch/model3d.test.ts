import { describe, expect, it } from 'vitest'
import { buildModel, depthField, profile, rotation } from './model3d'
import { initialState } from './transform'

describe('Rotate object 3D model', () => {
  const src = { x: 0, y: 0, w: 40, h: 40 }
  // A filled circle.
  const alpha = (x: number, y: number) => (Math.hypot(x - 20, y - 20) < 16 ? 255 : 0)

  it('is deepest in the middle and 0 outside', () => {
    const f = depthField(alpha, src, 40)
    expect(f.dist[20 * f.gw + 20]).toBe(f.max)
    expect(f.dist[0]).toBe(0)
    expect(f.paint[0]).toBe(0)
  })
  it('round goes up smoothly, straight sides jump up', () => {
    expect(profile(0.1, 1)).toBeLessThan(profile(0.1, 0))
    expect(profile(1, 1)).toBeCloseTo(1)
  })
  it('the front faces forward, the back backward, only where there is paint', () => {
    const m = buildModel(initialState(src), depthField(alpha, src, 40), { thick: 0.5, round: 1, light: 0.5 })
    let front = 0
    let back = 0
    for (let k = 0; k < m.verts.length; k += 8) {
      if (m.verts[k + 2] > 1) front++
      if (m.verts[k + 2] < -1) back++
    }
    expect(front).toBeGreaterThan(0)
    expect(front).toBe(back)
  })
  it('no turn is no rotation', () => {
    expect(rotation({ x: 0, y: 0, z: 0, depth: 0 }).map((v) => Math.round(v))).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1])
  })
})
