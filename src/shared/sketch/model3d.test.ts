import { describe, expect, it } from 'vitest'
import { buildModel, depthField, lightDir, profile, rotation, SHAPE_DEFAULT, STRIDE } from './model3d'
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
  it('the edge rises over its width: round curves up faster than a straight slope, a thin edge is a straight wall', () => {
    expect(profile(0.1, 1, 1)).toBeGreaterThan(profile(0.1, 0, 1))
    expect(profile(0.1, 0, 1)).toBeCloseTo(0.1)
    expect(profile(0.1, 0, 0.05)).toBe(1)
    expect(profile(0.6, 1, 0.5)).toBe(1)
    expect(profile(1, 1)).toBeCloseTo(1)
  })
  it('the outline follows the drawing between grid corners', () => {
    // A coarse grid (4 cells across 40 px) over a circle: edge corners move in onto the circle, off the grid.
    const f = depthField(alpha, src, 4)
    const m = buildModel(initialState(src), f, { ...SHAPE_DEFAULT, thick: 0.5 })
    let offGrid = 0
    for (let k = 0; k < m.verts.length; k += STRIDE) {
      const u = m.verts[k + 3] * 4
      if (Math.abs(u - Math.round(u)) > 0.01) offGrid++
    }
    expect(offGrid).toBeGreaterThan(0)
  })
  it('the light angle points where it says (225° is the top left)', () => {
    const [x, y, z] = lightDir(225)
    expect(x).toBeLessThan(0)
    expect(y).toBeLessThan(0)
    expect(z).toBeGreaterThan(0)
    expect(Math.hypot(x, y, z)).toBeCloseTo(1)
  })
  it('the front faces forward, the back backward, only where there is paint', () => {
    const m = buildModel(initialState(src), depthField(alpha, src, 40), { ...SHAPE_DEFAULT, thick: 0.5 })
    let front = 0
    let back = 0
    for (let k = 0; k < m.verts.length; k += STRIDE) {
      if (m.verts[k + 2] > 1) front++
      if (m.verts[k + 2] < -1) back++
    }
    expect(front).toBeGreaterThan(0)
    expect(front).toBe(back)
    // Each vertex knows its side, so the back can show something else.
    expect(m.verts[STRIDE - 1]).toBe(1)
    expect(m.verts[m.verts.length - 1]).toBe(-1)
  })
  it('no turn is no rotation', () => {
    expect(rotation({ x: 0, y: 0, z: 0, depth: 0 }).map((v) => Math.round(v))).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1])
  })
})
