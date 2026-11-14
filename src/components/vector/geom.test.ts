import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { anchorsOf, combine, fitCurve, loadGeom, offset, outline, regions } from './geom'
import { createVectorDoc, makeShape } from './model'
import { pathBox } from './paths'
import { combineNodes, snapDelta } from './tools'

beforeAll(() => loadGeom(readFileSync(fileURLToPath(new URL('./geom/vector-geom.wasm', import.meta.url)))))

const square = (x: number, y: number, s: number) => ({ d: `M${x} ${y}H${x + s}V${y + s}H${x}Z` })

describe('shape maths (Rust, WebAssembly)', () => {
  it('joins two overlapping squares into one outline', () => {
    const r = combine('unite', [square(0, 0, 10), square(5, 5, 10)])
    expect(r).toHaveLength(1)
    expect(r[0].paths).toHaveLength(1)
    expect(pathBox(r[0].paths)).toEqual({ x: 0, y: 0, width: 15, height: 15 })
  })

  it('cuts a hole and keeps the back shape as the source', () => {
    const r = combine('minus_front', [square(0, 0, 10), square(3, 3, 4)])
    expect(r[0].paths).toHaveLength(2)
    expect(r[0].sources).toEqual([0])
  })

  it('splits overlaps into pieces and finds every area for the shape builder', () => {
    expect(combine('divide', [square(0, 0, 10), square(5, 0, 10)])).toHaveLength(3)
    const parts = regions([square(0, 0, 10), square(5, 0, 10)])
    expect(parts).toHaveLength(3)
    expect(parts.some((p) => p.sources.length === 2)).toBe(true)
  })

  it('places shapes with their matrix (moved and scaled)', () => {
    const r = anchorsOf({ d: 'M0 0H1V1H0Z', m: [2, 0, 0, 2, 10, 20] })
    expect(pathBox(r.paths)).toEqual({ x: 10, y: 20, width: 2, height: 2 })
  })

  it('turns arcs into curves, grows, outlines and fits', () => {
    const circle = anchorsOf({ d: 'M0 5A5 5 0 1 1 10 5A5 5 0 1 1 0 5Z' })
    expect(circle.paths[0].anchors.length).toBeGreaterThanOrEqual(4)
    expect(circle.paths[0].anchors.some((a) => a.in || a.out)).toBe(true)
    const grown = pathBox(offset(square(0, 0, 10), 2, false).paths)
    expect(grown.width).toBeCloseTo(14, 1)
    const line = outline({ d: 'M0 0L10 0' }, 2, false)
    expect(pathBox(line.paths).height).toBeCloseTo(2, 1)
    const fit = fitCurve(Array.from({ length: 30 }, (_, i) => [i, Math.sin(i / 5) * 10]), false, 0.5)
    expect(fit.paths[0].anchors.length).toBeLessThan(12)
  })

  it('reports bad input as an error, not a crash', () => {
    expect(() => anchorsOf({ d: 'Q' })).toThrow()
    // Still works afterwards.
    expect(combine('unite', [square(0, 0, 1), square(2, 2, 1)])).toHaveLength(1)
  })
})

describe('combining in a drawing', () => {
  it('replaces the shapes with one result that remembers them, in the back shape’s place', () => {
    const d = createVectorDoc()
    const l = d.scene.layers[0].id
    const back = makeShape(l, 'rect', 0, 0, 20, 20, { fillColor: '#ff0000' })
    const between = makeShape(l, 'star', 50, 50, 5, 5)
    const front = makeShape(l, 'ellipse', 10, 10, 20, 20, { fillColor: '#00ff00' })
    d.scene.nodes = [back, between, front]
    const r = combineNodes(d.scene, [back.id, front.id], 'minus_front')
    expect(r.scene.nodes.map((n) => n.kind)).toEqual(['vpath', 'vshape'])
    const made = r.scene.nodes[0]
    expect(made.kind === 'vpath' && made.fillColor).toBe('#ff0000')
    expect(made.kind === 'vpath' && made.from?.map((n) => n.id)).toEqual([back.id, front.id])
  })

  it('needs two shapes', () => {
    const d = createVectorDoc()
    d.scene.nodes = [makeShape(d.scene.layers[0].id, 'rect', 0, 0, 5, 5)]
    expect(() => combineNodes(d.scene, [d.scene.nodes[0].id], 'unite')).toThrow(/two shapes/)
  })
})

describe('snapping', () => {
  const art = { x: 0, y: 0, width: 100, height: 100 }
  it('sticks the middle to the drawing’s middle and shows a guide', () => {
    const r = snapDelta({ x: 10, y: 10, width: 20, height: 20 }, [], 29, 0.3, { on: true, grid: 0, artboard: art }, 2)
    expect(r.dx).toBe(30)
    expect(r.guides).toContainEqual({ x: 50 })
  })
  it('falls back to whole pixels when nothing is close', () => {
    const r = snapDelta({ x: 10.2, y: 0, width: 7, height: 7 }, [], 13.1, 0, { on: true, grid: 1, artboard: art }, 0.5)
    expect(r.dx + 10.2).toBe(23)
  })
})
