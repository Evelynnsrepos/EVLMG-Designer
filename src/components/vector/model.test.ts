import { describe, expect, it } from 'vitest'
import { createVectorDoc, LOOKS, makeShape, PRESETS, shade, startFrom, toSvg } from './model'
import { roundedPolygon, SHAPES, shapePath } from './shapes'

const numbers = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)

describe('shapePath', () => {
  it('draws every shape as a closed path inside its box', () => {
    for (const shapeId of SHAPES) {
      const d = shapePath({ shapeId, width: 100, height: 60 })
      expect(d.startsWith('M'), shapeId).toBe(true)
      expect(d.trim().endsWith('Z'), shapeId).toBe(true)
      expect(d.includes('NaN'), shapeId).toBe(false)
      // Arcs carry radii and flags, and the shield's top curve bends through a point above it, so check the others.
      if (!/A/.test(d) && shapeId !== 'shield') for (const v of numbers(d)) expect(v >= -0.01 && v <= 100.01, `${shapeId} ${v}`).toBe(true)
    }
  })

  it('fills the box it is drawn in, also for odd polygons', () => {
    const ys = numbers(shapePath({ shapeId: 'polygon', width: 90, height: 90, sides: 3 })).filter((_, i) => i % 2)
    expect(Math.min(...ys)).toBeCloseTo(0)
    expect(Math.max(...ys)).toBeCloseTo(90)
  })

  it('rounds corners only as far as the edges allow', () => {
    const sharp = roundedPolygon([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], 0)
    expect(sharp).toBe('M 0 0 L 10 0 L 10 10 Z')
    const round = roundedPolygon([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], 99)
    expect(round).toContain('Q 10 0')
  })
})

describe('Vector document', () => {
  it('starts every preset with its size and an example on the first layer', () => {
    for (const p of PRESETS) {
      const d = startFrom(p, createVectorDoc())
      expect(d.presetId).toBe(p.id)
      expect(d.artboard).toEqual({ width: p.width, height: p.height })
      expect(d.scene.nodes.every((n) => n.layerId === d.scene.layers[0].id)).toBe(true)
      expect(startFrom(p, createVectorDoc(), false).scene.nodes).toEqual([])
    }
  })

  it('shades colours towards black and white', () => {
    expect(shade('#808080', -0.5)).toBe('#404040')
    expect(shade('#000000', 1)).toBe('#ffffff')
  })

  it('looks only change the look, not the shape', () => {
    const n = makeShape('l', 'star', 10, 20, 50, 50, { fillColor: '#ff0000' })
    for (const l of LOOKS) {
      const p = l.apply(n, { width: 128, height: 128 })
      expect(Object.keys(p).every((k) => ['fillColor', 'fill2Color', 'strokeColor', 'strokeWidth', 'shadow', 'opacity'].includes(k)), l.id).toBe(true)
    }
  })
})

describe('toSvg', () => {
  it('writes the artboard with gradients, shadows and text, and skips hidden things', () => {
    const d = createVectorDoc()
    const l = d.scene.layers[0].id
    d.artboard = { width: 64, height: 32, bgColor: '#ffffff' }
    d.scene.nodes = [
      makeShape(l, 'rect', 2, 2, 20, 20, { fillColor: '#ff0000', fill2Color: '#00ff00', shadow: true, strokeColor: '#000000', strokeWidth: 2 }),
      { ...makeShape(l, 'ellipse', 0, 0, 5, 5), hidden: true },
      { id: 't', kind: 'text', layerId: l, x: 30, y: 4, text: 'A<B', fontSize: 10, width: 20, textColor: '#123456' },
    ]
    const svg = toSvg(d)
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="64" height="32" viewBox="0 0 64 32">/)
    expect(svg).toContain('<rect width="64" height="32" fill="#ffffff"/>')
    expect(svg).toContain('fill="url(#g0)"')
    expect(svg).toContain('filter="url(#s1)"')
    expect(svg).toContain('stroke-width="2"')
    expect(svg).toContain('A&lt;B')
    expect(svg.match(/<path /g)).toHaveLength(1)
  })

  it('leaves out hidden layers', () => {
    const d = startFrom(PRESETS[0], createVectorDoc())
    d.scene.layers[0] = { ...d.scene.layers[0], hidden: true }
    expect(toSvg(d)).not.toContain('<path')
  })
})
