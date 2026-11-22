import { describe, expect, it } from 'vitest'
import { buildMesh, initialState, mapPoint, moldDrag, moldKeepShape, moldLive, paintedCells, toMold, toWarp, turn3d } from './transform'

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

describe('mold keep shape', () => {
  // A bar 100 × 20 as 10 × 10 cells; only the middle row of cells... all cells hold paint here.
  const bar = toMold(initialState({ x: 0, y: 0, w: 100, h: 20 }), 10)
  it('bending the free end keeps the bar about as long (it turns, does not stretch)', () => {
    const m = bar.mold!
    const n = m.n
    const fixed = new Map<number, { x: number; y: number }>()
    // Pin the left column, pull the right end up and in, as if bending at a joint.
    for (let j = 0; j <= n; j++) fixed.set(j * (n + 1), m.pts[j * (n + 1)])
    const tip = 5 * (n + 1) + n
    fixed.set(tip, { x: 70, y: -60 })
    let out = m
    for (let k = 0; k < 20; k++) out = moldKeepShape(out, fixed)
    // Length along the middle row stays near 100 (a stretchy pull would be much shorter or longer).
    let len = 0
    for (let i = 0; i < n; i++) {
      const a = out.pts[5 * (n + 1) + i]
      const b = out.pts[5 * (n + 1) + i + 1]
      len += Math.hypot(b.x - a.x, b.y - a.y)
    }
    expect(len).toBeGreaterThan(85)
    expect(len).toBeLessThan(125)
  })
  it('empty cells are left out of the mesh', () => {
    const on = paintedCells((x) => (x < 50 ? 255 : 0), { x: 0, y: 0, w: 100, h: 20 }, 10)
    expect(on.filter(Boolean).length).toBe(50)
    const s = toMold(initialState({ x: 0, y: 0, w: 100, h: 20 }), 10, on)
    expect(buildMesh(s).pos.length).toBe(50 * 12)
    expect(moldLive(s.mold!).filter(Boolean).length).toBe(6 * 11)
  })
  it('pinned points do not follow a plain drag', () => {
    const m = { ...bar.mold!, pins: [1] }
    expect(moldDrag(m, 0, 10, 0, 100, 1).pts[1]).toBe(m.pts[1])
  })
})
