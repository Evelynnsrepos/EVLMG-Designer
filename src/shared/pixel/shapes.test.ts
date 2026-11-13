import { describe, expect, it } from 'vitest'
import { getPx } from './model'
import { drawShapes, fillInBetweens, fromQuickShape, fromStroke, hitShape, newShape, trace, tween } from './shapes'

const square = (x: number, y: number, s: number) => [
  { x, y },
  { x: x + s, y },
  { x: x + s, y: y + s },
  { x, y: y + s },
]

describe('live shapes', () => {
  it('draws fill and outline into pixels', () => {
    const img = drawShapes([newShape(square(2, 2, 6), true, { fillColor: '#ff0000', strokeColor: '#000000' })], 12, 12)
    expect(getPx(img, 5, 5)).toEqual([255, 0, 0, 255])
    expect(getPx(img, 2, 5)).toEqual([0, 0, 0, 255])
    expect(getPx(img, 10, 10)[3]).toBe(0)
  })

  it('smooth shapes pass through their points and close', () => {
    const s = newShape(square(0, 0, 10), true, { smooth: true })
    const t = trace(s)
    expect(t[0]).toEqual({ x: 0, y: 0 })
    expect(t[t.length - 1]).toEqual(t[0])
    expect(t.some((p) => Math.abs(p.x - 10) < 0.01 && Math.abs(p.y - 10) < 0.01)).toBe(true)
  })

  it('finds points, edges and insides', () => {
    const list = [newShape(square(0, 0, 10), true, { fillColor: '#fff' })]
    expect(hitShape(list, { x: 10, y: 0 }, 1)).toEqual({ shape: 0, point: 1 })
    expect(hitShape(list, { x: 5, y: 0 }, 1)).toEqual({ shape: 0, edge: 0 })
    expect(hitShape(list, { x: 5, y: 5 }, 1)).toEqual({ shape: 0, inside: true })
    expect(hitShape(list, { x: 30, y: 30 }, 1)).toBeNull()
  })

  it('turns snapped circles and strokes into editable shapes', () => {
    const c = fromQuickShape({ kind: 'circle', points: [{ x: 20, y: 20 }, { x: 10, y: 10 }] })
    expect(c.points).toHaveLength(8)
    expect(c.smooth && c.closed).toBe(true)
    const tri = fromStroke([...Array.from({ length: 10 }, (_, i) => ({ x: i * 2, y: 0 })), ...Array.from({ length: 10 }, (_, i) => ({ x: 20 - i, y: i * 2 })), ...Array.from({ length: 11 }, (_, i) => ({ x: 10 - i, y: 20 - i * 2 }))])!
    expect(tri.closed).toBe(true)
    expect(tri.points.length).toBe(3)
  })

  it('tweens matched shapes, also with different point counts', () => {
    const a = newShape(square(0, 0, 10), true)
    const b = { ...a, points: square(10, 0, 10) }
    expect(tween([a], [b], 0.5)[0].points[0]).toEqual({ x: 5, y: 0 })
    const tri = { ...a, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 8 }] }
    expect(tween([tri], [b], 0.5)[0].points).toHaveLength(4)
  })

  it('fills the frames between keys and leaves keys alone', () => {
    const a = newShape([{ x: 0, y: 0 }, { x: 0, y: 4 }], false)
    const b = { ...a, points: [{ x: 12, y: 0 }, { x: 12, y: 4 }] }
    const filled = fillInBetweens([{ key: true, list: [a] }, undefined, { key: false, list: [] }, { key: true, list: [b] }, undefined])
    expect([...filled.keys()]).toEqual([1, 2])
    expect(filled.get(1)!.list[0].points[0].x).toBe(4)
    expect(filled.get(2)!.key).toBe(false)
  })
})

describe('reshapeBox', () => {
  it('keeps a rectangle a rectangle and a square a square', async () => {
    const { boxPoints, reshapeBox, newShape } = await import('./shapes')
    const sq = newShape(boxPoints('rect', 0, 0, 10, 10), true, { box: 'rect' })
    const free = reshapeBox(sq, 2, { x: 20, y: 14 })!
    expect(free).toEqual(boxPoints('rect', 0, 0, 20, 14))
    const kept = reshapeBox(sq, 2, { x: 20, y: 14 }, true)!
    expect(kept).toEqual(boxPoints('rect', 0, 0, 20, 20))
    expect(reshapeBox({ ...sq, box: undefined }, 2, { x: 5, y: 5 })).toBeNull()
  })
  it('keeps a circle round when a point is dragged with keep', async () => {
    const { boxPoints, reshapeBox, newShape } = await import('./shapes')
    const c = newShape(boxPoints('ellipse', 0, 0, 10, 10), true, { box: 'ellipse', smooth: true })
    // Point 0 is the right-hand point: only the right edge moves, the height follows around the centre.
    expect(reshapeBox(c, 0, { x: 20, y: 5 }, true)).toEqual(boxPoints('ellipse', 0, -5, 20, 15))
  })
})
