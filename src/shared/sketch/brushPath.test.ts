import { describe, expect, it } from 'vitest'
import { CurveFill, PathSmoother } from './brushPath'

const line = (n: number, wobble = 0) => Array.from({ length: n }, (_, i) => ({ x: i * 4, y: (i % 2 ? 1 : -1) * wobble, pressure: 1 }))

describe('PathSmoother', () => {
  it('passes points through when off', () => {
    const s = new PathSmoother(0, 0, 0)
    const p = { x: 3, y: 4, pressure: 0.5 }
    expect(s.push(p)).toBe(p)
    expect(s.flush()).toEqual([])
  })

  it('stabilization trails behind and catches up at the end', () => {
    const s = new PathSmoother(0.5, 0, 0)
    const pts = line(30)
    const out = pts.map((p) => s.push(p))
    expect(out[29].x).toBeLessThan(pts[29].x)
    const tail = s.flush()
    expect(tail[tail.length - 1].x).toBeCloseTo(pts[29].x)
  })

  it('motion filtering removes small shakes, expression keeps some', () => {
    const shake = (f: number, e: number) => {
      const s = new PathSmoother(0, f, e)
      const ys = line(40, 2).map((p) => s.push(p).y).slice(10)
      return Math.max(...ys) - Math.min(...ys)
    }
    expect(shake(1, 0)).toBeLessThan(1)
    expect(shake(1, 0.5)).toBeGreaterThan(shake(1, 0))
    expect(shake(0, 0)).toBeCloseTo(4)
  })
})

describe('CurveFill', () => {
  it('keeps a fast circle round instead of a polygon', () => {
    const r = 300
    const pen = Array.from({ length: 13 }, (_, i) => ({ x: r * Math.cos((i / 12) * Math.PI * 2), y: r * Math.sin((i / 12) * Math.PI * 2), pressure: 0.5 }))
    const c = new CurveFill<(typeof pen)[number]>()
    const out = [...pen.flatMap((p) => c.push(p)), ...c.flush()]
    const off = (p: { x: number; y: number }) => Math.abs(Math.hypot(p.x, p.y) - r)
    // Straight lines between the 12 points sag ~10 px inside the circle at their middles.
    // Away from the stroke's two ends (no point beyond them to aim the curve), it stays on the circle.
    expect(Math.max(...out.filter((p) => { const a = (Math.atan2(p.y, p.x) + Math.PI * 2) % (Math.PI * 2); return a > Math.PI / 6 && a < Math.PI * 2 - Math.PI / 6 }).map(off))).toBeLessThan(1.5)
    expect(out.length).toBeGreaterThan(200)
    expect(out.at(-1)).toEqual(pen.at(-1))
  })
  it('leaves slow, close points alone', () => {
    const c = new CurveFill<{ x: number; y: number; pressure: number }>()
    const pts = [0, 1, 2, 3].map((x) => ({ x, y: 0, pressure: 1 }))
    expect([...pts.flatMap((p) => c.push(p)), ...c.flush()]).toEqual(pts)
  })
})
