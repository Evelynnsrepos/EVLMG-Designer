import { describe, expect, it } from 'vitest'
import { brushKey, mapWiggle, packPoints, rasterized, unpackPoints, wiggled, withStroke } from './animatedLayers'
import { normalizeSettings } from './brushes'
import { animatedLoop } from './files/io'
import { newLayer } from './model'

const line = Array.from({ length: 40 }, (_, i) => ({ x: 100 + i * 5, y: 200, pressure: 1 }))

describe('animated layers', () => {
  it('a still brush does not move; an animated one moves a little, the same way every time', () => {
    const still = normalizeSettings({ size: 10 })
    expect(wiggled(line, still, 7, 2, 4)).toBe(line)
    const b = normalizeSettings({ size: 10, wiggle: 0.5 })
    const a1 = wiggled(line, b, 7, 2, 4)
    expect(a1).toEqual(wiggled(line, b, 7, 2, 4))
    const reach = Math.max(...a1.map((p, i) => Math.hypot(p.x - line[i].x, p.y - line[i].y)))
    expect(reach).toBeGreaterThan(0.5)
    expect(reach).toBeLessThanOrEqual(0.5 * (6 + 10 * 0.8) * Math.SQRT2 + 1e-9)
    // Another frame wobbles differently.
    expect(wiggled(line, b, 7, 3, 4)).not.toEqual(a1)
  })

  it('a wave loops: frame n is frame 0 again', () => {
    const b = normalizeSettings({ size: 10, wiggle: 0.5, wiggleStyle: 'wave' })
    const f0 = wiggled(line, b, 1, 0, 4)
    const f4 = wiggled(line, b, 1, 4, 4)
    f0.forEach((p, i) => expect(Math.abs(p.y - f4[i].y)).toBeLessThan(1e-6))
  })

  it('keeps strokes compactly, each brush once', () => {
    const b = normalizeSettings({ size: 4, wiggle: 0.3 })
    const pts = unpackPoints(packPoints([{ x: 1.234, y: 5.678, pressure: 0.12345 }]))
    expect(pts).toEqual([{ x: 1.2, y: 5.7, pressure: 0.123 }])
    let w = withStroke(undefined, { brush: b, color: '#000', erase: false, smudge: false, points: line, seed: 1 })
    w = withStroke(w, { brush: b, color: '#f00', erase: true, smudge: false, points: line, seed: 2 })
    expect(w.strokes).toHaveLength(2)
    expect(Object.keys(w.brushes)).toEqual([brushKey(b)])
    expect(w.strokes[1].erase).toBe(true)
    const moved = mapWiggle(w, (p) => ({ x: p.x + 10, y: p.y }))
    expect(moved.strokes[0].points[0]).toBe(110)
    expect(moved.strokes[0].points[2]).toBe(1)
  })

  it('exports one whole loop of every animated layer', () => {
    const a = { ...newLayer('a'), wiggle: { frames: 4, fps: 10, brushes: {}, strokes: [] } }
    const b = { ...newLayer('b'), wiggle: { frames: 6, fps: 8, brushes: {}, strokes: [] } }
    expect(animatedLoop([newLayer('x')])).toBeNull()
    expect(animatedLoop([a, b])).toEqual({ frames: 12, fps: 10 })
    expect('wiggle' in rasterized(a)).toBe(false)
  })
})
