import { describe, expect, it } from 'vitest'
import { initialState, mapPoint, moldDrag, toMold, toWarp, turn3d } from './transform'

const s = initialState({ x: 0, y: 0, w: 100, h: 50 })

describe('3D turn', () => {
  it('no turn changes nothing', () => {
    const t = turn3d(s, { x: 0, y: 0, z: 0, depth: 0.5 })
    t.quad.forEach((p, i) => {
      expect(p.x).toBeCloseTo(s.quad[i].x)
      expect(p.y).toBeCloseTo(s.quad[i].y)
    })
  })
  it('turning 180° around the up axis shows the mirrored back', () => {
    const t = turn3d(s, { x: 0, y: 180, z: 0, depth: 0 })
    expect(t.quad[0].x).toBeCloseTo(100)
    expect(t.quad[1].x).toBeCloseTo(0)
  })
  it('with perspective the near side grows', () => {
    const t = turn3d(s, { x: 0, y: 40, z: 0, depth: 1 })
    const left = t.quad[3].y - t.quad[0].y
    const right = t.quad[2].y - t.quad[1].y
    expect(Math.abs(left - right)).toBeGreaterThan(5)
  })
})

describe('mold', () => {
  it('a fresh mold keeps the shape', () => {
    const m = toMold(s, 4)
    expect(mapPoint(m, 0.3, 0.7).x).toBeCloseTo(30)
    expect(mapPoint(m, 0.3, 0.7).y).toBeCloseTo(35)
  })
  it('the dragged point moves fully, near points partly, far points not', () => {
    const m = toMold(s, 4).mold!
    const i = 2 * 5 + 2 // middle
    const out = moldDrag(m, i, 10, 0, 30, 0.5)
    expect(out.pts[i].x - m.pts[i].x).toBeCloseTo(10)
    const near = out.pts[i + 1].x - m.pts[i + 1].x
    expect(near).toBeGreaterThan(0)
    expect(near).toBeLessThan(5)
    expect(out.pts[0]).toBe(m.pts[0])
  })
  it('going to Warp leaves the mold', () => {
    expect(toWarp(toMold(s, 4)).mold).toBeNull()
  })
})
