import { describe, expect, it } from 'vitest'
import { outline, recognize, resize, type Pt } from './quickshape'

const wobble = (pts: Pt[], amount = 2) => pts.map((p, i) => ({ x: p.x + Math.sin(i * 1.7) * amount, y: p.y + Math.cos(i * 2.3) * amount }))
const path = (corners: Pt[], n = 20) =>
  corners.slice(1).flatMap((b, i) => {
    const a = corners[i]
    return Array.from({ length: n }, (_, k) => ({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n }))
  })
const ring = (cx: number, cy: number, rx: number, ry: number, n = 60) =>
  Array.from({ length: n + 1 }, (_, i) => ({ x: cx + Math.cos((i / n) * Math.PI * 2) * rx, y: cy + Math.sin((i / n) * Math.PI * 2) * ry }))

describe('quickshape', () => {
  it('straightens a wobbly line', () => {
    const s = recognize(wobble(path([{ x: 0, y: 0 }, { x: 200, y: 50 }])))
    expect(s?.kind).toBe('line')
  })

  it('finds rectangles, triangles, circles and ellipses', () => {
    const rect = recognize(wobble(path([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 120 }, { x: 0, y: 120 }, { x: 0, y: 2 }])))
    expect(rect?.kind).toBe('rectangle')
    const tri = recognize(wobble(path([{ x: 0, y: 100 }, { x: 60, y: 0 }, { x: 120, y: 100 }, { x: 2, y: 100 }])))
    expect(tri?.kind).toBe('triangle')
    expect(recognize(wobble(ring(100, 100, 80, 78)))?.kind).toBe('circle')
    expect(recognize(wobble(ring(100, 100, 120, 50)))?.kind).toBe('ellipse')
    // Scribbled round three times, ending somewhere else: still a circle.
    const loops = Array.from({ length: 200 }, (_, i) => {
      const a = (i / 200) * Math.PI * 2 * 2.7
      return { x: 100 + Math.cos(a) * (80 + (i % 7)), y: 100 + Math.sin(a) * (78 - (i % 5)) }
    })
    expect(recognize(loops)?.kind).toBe('circle')
  })

  it('outlines close the shape and resizing scales it', () => {
    const c = recognize(ring(0, 0, 50, 50))!
    const o = outline(c)
    expect(Math.hypot(o[0].x - o[o.length - 1].x, o[0].y - o[o.length - 1].y)).toBeLessThan(1)
    const big = resize(c, { x: 50, y: 0 }, { x: 100, y: 0 })
    expect(big.points[1].x).toBeCloseTo(c.points[1].x * 2)
  })
})

describe('perfect shapes', async () => {
  const { perfect } = await import('./quickshape')
  it('snaps lines to 15 degree steps and makes squares and circles', () => {
    const l = perfect({ kind: 'line', points: [{ x: 0, y: 0 }, { x: 100, y: 3 }] })
    expect(l.points[1].y).toBeCloseTo(0)
    const sq = perfect({ kind: 'rectangle', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }] })
    expect(sq.points[1].x - sq.points[0].x).toBeCloseTo(sq.points[3].y - sq.points[0].y)
    expect(perfect({ kind: 'ellipse', points: [{ x: 0, y: 0 }, { x: 40, y: 20 }] }).kind).toBe('circle')
  })
})

describe('v0.28 fitting', async () => {
  const { perfect, shapeNodes, moveNode } = await import('./quickshape')
  const rot = (pts: Pt[], a: number, c: Pt) => pts.map((p) => ({ x: c.x + (p.x - c.x) * Math.cos(a) - (p.y - c.y) * Math.sin(a), y: c.y + (p.x - c.x) * Math.sin(a) + (p.y - c.y) * Math.cos(a) }))

  it('averages several sloppy rounds into one circle in the middle', () => {
    // Four rounds that drift sideways and change size, the way a hand scribbles.
    const loops = Array.from({ length: 400 }, (_, i) => {
      const a = (i / 400) * Math.PI * 2 * 4
      const r = 60 + Math.sin(i / 30) * 6
      return { x: 200 + (i / 400) * 14 + Math.cos(a) * r, y: 150 + Math.sin(a) * r }
    })
    const s = recognize(loops)!
    expect(s.kind).toBe('circle')
    expect(s.points[0].x).toBeGreaterThan(203)
    expect(s.points[0].x).toBeLessThan(211)
    expect(s.points[1].x).toBeGreaterThan(55)
    expect(s.points[1].x).toBeLessThan(65)
  })

  it('keeps a tilted ellipse tilted, and levels a nearly level one', () => {
    const tilted = recognize(wobble(rot(ring(100, 100, 100, 40, 90), 0.6, { x: 100, y: 100 })))!
    expect(tilted.kind).toBe('ellipse')
    expect(tilted.angle).toBeCloseTo(0.6, 1)
    expect(Math.max(tilted.points[1].x, tilted.points[1].y)).toBeGreaterThan(90)
    const level = recognize(wobble(rot(ring(100, 100, 100, 40, 90), 0.05, { x: 100, y: 100 })))!
    expect(level.angle ?? 0).toBe(0)
    const o = outline(tilted)
    expect(Math.hypot(o[0].x - o[o.length - 1].x, o[0].y - o[o.length - 1].y)).toBeLessThan(1)
    // Handles sit on the tilted axes.
    const [, h1] = shapeNodes(tilted)
    expect(Math.atan2(h1.y - tilted.points[0].y, h1.x - tilted.points[0].x)).toBeCloseTo(tilted.angle!, 3)
    expect(moveNode(tilted, 1, h1).points[1].x).toBeCloseTo(tilted.points[1].x)
  })

  it('finds a tilted rectangle and squares it the same way round', () => {
    const corners = rot([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 }, { x: 0, y: 2 }], 0.4, { x: 100, y: 50 })
    const r = recognize(wobble(path(corners)))!
    expect(r.kind).toBe('rectangle')
    expect(Math.atan2(r.points[1].y - r.points[0].y, r.points[1].x - r.points[0].x)).toBeCloseTo(0.4, 1)
    const sq = perfect(r)
    const side = (i: number) => Math.hypot(sq.points[(i + 1) % 4].x - sq.points[i].x, sq.points[(i + 1) % 4].y - sq.points[i].y)
    expect(side(0)).toBeCloseTo(side(1))
  })

  it('turns a smooth bend into an arc that can be resized and edited', () => {
    const bend = Array.from({ length: 60 }, (_, i) => {
      const a = Math.PI + (i / 59) * Math.PI * 0.8
      return { x: 100 + Math.cos(a) * 80, y: 100 + Math.sin(a) * 80 }
    })
    const s = recognize(wobble(bend, 1))!
    expect(s.kind).toBe('arc')
    const o = outline(s)
    expect(Math.hypot(o[0].x - 20, o[0].y - 100)).toBeLessThan(4)
    for (const q of o) expect(Math.abs(Math.hypot(q.x - 100, q.y - 100) - 80)).toBeLessThan(4)
    const big = resize(s, s.points[2], { x: s.points[2].x + 50, y: s.points[2].y })
    expect(big.points[2].x).toBeCloseTo(s.points[2].x + 50)
    expect(moveNode(s, 1, { x: 100, y: 0 }).kind).toBe('arc')
    // A wavy S is not an arc.
    const wave = Array.from({ length: 80 }, (_, i) => ({ x: i * 4, y: Math.sin((i / 79) * Math.PI * 2) * 40 }))
    expect(recognize(wave)?.kind).not.toBe('arc')
  })
})
