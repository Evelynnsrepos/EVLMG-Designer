import { describe, expect, it } from 'vitest'
import { alphaBounds } from './engine'
import { GROW_STEP, growDoc, growFor } from './growth'

describe('growing the working area (0.31)', () => {
  it('stays the same while paint is inside with room to spare', () => {
    expect(growFor(1000, 800, { x: 100, y: 100, w: 50, h: 50 }, 64)).toBeNull()
  })
  it('grows the side the paint is near, in whole steps', () => {
    expect(growFor(1000, 800, { x: -10, y: 100, w: 50, h: 50 }, 64)).toEqual({ left: GROW_STEP, top: 0, width: 1000 + GROW_STEP, height: 800 })
    expect(growFor(1000, 800, { x: 900, y: 790, w: 50, h: 50 }, 64)).toEqual({ left: 0, top: 0, width: 1000 + GROW_STEP, height: 800 + GROW_STEP })
    expect(growFor(1000, 800, { x: -700, y: 0, w: 10, h: 10 }, 64)!.left).toBe(2 * GROW_STEP)
  })
  it('never passes the largest size', () => {
    const g = growFor(8000, 100, { x: -100, y: 0, w: 8300, h: 10 }, 64, 8192)!
    expect(g.width).toBe(8192)
    expect(growFor(8192, 1000, { x: -100, y: 400, w: 10, h: 10 }, 64, 8192)).toBeNull()
  })
})

describe('the drawing after growing', () => {
  it('moves the frame, text boxes and guide, and keeps the rest', () => {
    const doc: { width: number; height: number; frame?: { x: number; y: number; w: number; h: number }; layers: { id: string; text?: { x: number; y: number; text: string } }[]; guide: object; backgroundColor: string } = { width: 100, height: 80, layers: [{ id: 'a', text: { x: 5, y: 6, text: 'hi' } }, { id: 'b' }], guide: { center: { x: 50, y: 40 }, vanishing: [{ x: 1, y: 2 }], size: 10 }, backgroundColor: '#fff' }
    const g = { left: 512, top: 0, width: 612, height: 80 }
    const out = growDoc(doc, g)
    expect(out.frame).toEqual({ x: 512, y: 0, w: 100, h: 80 })
    expect([out.width, out.height]).toEqual([612, 80])
    expect(out.layers[0].text).toEqual({ x: 517, y: 6, text: 'hi' })
    expect(out.layers[1]).toEqual({ id: 'b' })
    expect(out.guide).toEqual({ center: { x: 562, y: 40 }, vanishing: [{ x: 513, y: 2 }], size: 10 })
    expect(growDoc(out, { left: 0, top: 512, width: 612, height: 592 }).frame).toEqual({ x: 512, y: 512, w: 100, h: 80 })
  })
})

describe('alphaBounds (only the painted part past the canvas is shown)', () => {
  const img = (w: number, h: number, px: [number, number][]) => {
    const data = new Uint8ClampedArray(w * h * 4)
    for (const [x, y] of px) data[(y * w + x) * 4 + 3] = 1
    return { data, width: w, height: h } as ImageData
  }
  it('is null for an empty layer', () => expect(alphaBounds(img(8, 8, []), 32, 32)).toBeNull())
  it('scales up and pads by one small pixel, within the area', () => {
    expect(alphaBounds(img(8, 8, [[2, 3], [4, 3]]), 32, 32)).toEqual({ x: 32, y: 64, w: 160, h: 96 })
    expect(alphaBounds(img(8, 8, [[0, 0], [7, 7]]), 32, 32)).toEqual({ x: 0, y: 0, w: 256, h: 256 })
  })
})
