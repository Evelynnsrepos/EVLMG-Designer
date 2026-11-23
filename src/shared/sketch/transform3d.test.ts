import { describe, expect, it } from 'vitest'
import { buildMold, cellParts, moldAt, moldFollow, moldKeepShape, pastePose, remold, spotAt, spotPos, type Hold, type Mold, type Spot } from './mold'
import { buildMesh, initialState, mapPoint, toWarp, turn3d } from './transform'

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

const flat = (box: { x: number; y: number; w: number; h: number }, n: number, parts?: Int32Array) => {
  const st = initialState(box)
  return { ...st, mold: buildMold(n, (u, v) => { const p = mapPoint(st, u, v); return { p, r: p } }, parts) }
}
/** The mesh point at source (u, v) of part `pick` (the first one when several share the place). */
const at = (m: Mold, u: number, v: number) => m.uv.findIndex((q) => Math.abs(q.x - u) < 1e-9 && Math.abs(q.y - v) < 1e-9)
const one = (m: Mold, k: number): Spot => {
  const i = m.tris.indexOf(k)
  const b: [number, number, number] = [0, 0, 0]
  b[i % 3] = 1
  return { t: Math.floor(i / 3), b }
}

describe('mold', () => {
  it('a fresh mold keeps the shape', () => {
    const m = flat(s.src, 4)
    expect(mapPoint(m, 0.3, 0.7).x).toBeCloseTo(30)
    expect(mapPoint(m, 0.3, 0.7).y).toBeCloseTo(35)
  })
  it('the grabbed triangle moves fully, near points partly, far points not', () => {
    const m = flat(s.src, 4).mold!
    const g = spotAt(m, { x: 50, y: 25 })!
    const out = moldFollow(m, [g.t], [{ x: 50, y: 25 }], (q) => ({ x: q.x + 10, y: q.y }), 30, 0.5, [])
    expect(spotPos(out, g).x).toBeCloseTo(60)
    const far = at(m, 0, 0)
    expect(out.pts[far].x).toBeCloseTo(m.pts[far].x)
    const near = at(m, 0.25, 0.5)
    expect(out.pts[near].x - m.pts[near].x).toBeGreaterThan(0)
  })
  it('going to Warp leaves the mold', () => {
    expect(toWarp(flat(s.src, 4)).mold).toBeNull()
  })
  it('front parts are drawn last', () => {
    const m = flat(s.src, 2).mold!
    const mesh = buildMesh({ ...flat(s.src, 2), mold: { ...m, depth: [0, 0, 5, 0, 0, 0, 0, 0] } })
    // Triangle 2 (top right cell) ends the list.
    const last = [...mesh.uv.slice(-6)]
    expect(last.every((v, i) => (i % 2 ? v <= 0.5 : v >= 0.5))).toBe(true)
  })
})

describe('mold parts', () => {
  const box = { x: 0, y: 0, w: 100, h: 20 }
  it('cells only join where the paint touches', () => {
    // Two blobs with a 2 px gap at x 49..50: neighbouring cells, but separate parts.
    const parts = cellParts((x) => (x === 49 || x === 50 ? 0 : 255), box, 10)
    expect(new Set(parts).size).toBe(2)
    const joined = cellParts(() => 255, box, 10)
    expect(new Set(joined).size).toBe(1)
  })
  it('separate parts get their own points, so one bends without the other', () => {
    const parts = cellParts((x) => (x === 49 || x === 50 ? 0 : 255), box, 10)
    const st = flat(box, 10, parts)
    // The side x = 50 has points for both parts.
    expect(st.mold!.uv.filter((q) => Math.abs(q.x - 0.5) < 1e-9).length).toBe(2 * 11)
    const right = st.mold!.uv.findIndex((q, i) => q.x > 0.75 && st.mold!.uv[i])
    const out = moldFollow(st.mold!, [], [st.mold!.pts[right]], (q) => ({ x: q.x, y: q.y + 30 }), 40, 1, [])
    const left = at(st.mold!, 0.1, 0.5)
    expect(out.pts[left].y).toBeCloseTo(st.mold!.pts[left].y)
  })
  it('empty cells are left out of the mesh', () => {
    const parts = cellParts((x) => (x < 50 ? 255 : 0), box, 10)
    expect([...parts].filter((p) => p >= 0).length).toBe(50)
    expect(buildMesh(flat(box, 10, parts)).pos.length).toBe(50 * 12)
  })
})

describe('mold keep shape', () => {
  const bar = flat({ x: 0, y: 0, w: 100, h: 20 }, 10)
  it('bending the free end keeps the bar about as long (it turns, does not stretch)', () => {
    const m = bar.mold!
    const holds: Hold[] = []
    for (let j = 0; j <= 10; j++) {
      const k = at(m, 0, j / 10)
      holds.push({ ...one(m, k), p: m.pts[k] })
    }
    const tip = at(m, 1, 0.5)
    holds.push({ ...one(m, tip), p: { x: 70, y: -60 } })
    let out = m
    for (let k = 0; k < 20; k++) out = moldKeepShape(out, holds)
    let len = 0
    for (let i = 0; i < 10; i++) {
      const a = out.pts[at(m, i / 10, 0.5)]
      const b = out.pts[at(m, (i + 1) / 10, 0.5)]
      len += Math.hypot(b.x - a.x, b.y - a.y)
    }
    expect(len).toBeGreaterThan(85)
    expect(len).toBeLessThan(125)
  })
  it('a pin in the middle of a triangle holds its spot', () => {
    const m = bar.mold!
    const pin = spotAt(m, { x: 13, y: 7 })!
    const tip = at(m, 1, 0.5)
    const out = moldKeepShape(m, [{ ...pin, p: { x: 13, y: 7 } }, { ...one(m, tip), p: { x: 80, y: 40 } }], 40)
    expect(spotPos(out, pin).x).toBeCloseTo(13, 1)
    expect(spotPos(out, pin).y).toBeCloseTo(7, 1)
  })
  it('pinned spots do not follow a plain drag', () => {
    const m = bar.mold!
    const pin = spotAt(m, { x: 15, y: 10 })!
    const g = spotAt(m, { x: 5, y: 10 })!
    const out = moldFollow(m, [g.t], [{ x: 5, y: 10 }], (q) => ({ x: q.x, y: q.y + 10 }), 100, 1, [{ ...pin, p: spotPos(m, pin) }])
    expect(spotPos(out, pin).y).toBeCloseTo(10)
  })
  it('a finer mesh keeps the bend, rest shape and pins', () => {
    const m = bar.mold!
    const pin = spotAt(m, { x: 30, y: 10 })!
    const bent = moldFollow({ ...m, pins: [pin] }, [], [{ x: 100, y: 10 }], (q) => ({ x: q.x, y: q.y + 20 }), 60, 1, [])
    const fine = remold(bent, 20)
    expect(moldAt(fine, 0.9, 0.5).y).toBeCloseTo(moldAt(bent, 0.9, 0.5).y, 0)
    expect(moldAt(fine, 0.9, 0.5, fine.rest).y).toBeCloseTo(10)
    expect(fine.pins.length).toBe(1)
    expect(spotPos(fine, fine.pins[0]).x).toBeCloseTo(spotPos(bent, pin).x, 0)
  })
  it('a pasted pose bends a same-size drawing the same way', () => {
    const m = bar.mold!
    const bent = moldFollow(m, [], [{ x: 100, y: 10 }], (q) => ({ x: q.x, y: q.y + 20 }), 60, 1, [])
    const other = flat({ x: 200, y: 0, w: 100, h: 20 }, 10).mold!
    const out = pastePose(other, { x: 200, y: 0, w: 100, h: 20 }, { mold: bent, src: { x: 0, y: 0, w: 100, h: 20 } })
    expect(moldAt(out, 1, 0.5).y - 10).toBeCloseTo(moldAt(bent, 1, 0.5).y - 10)
  })
})
