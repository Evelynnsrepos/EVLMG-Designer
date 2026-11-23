import { describe, expect, it } from 'vitest'
import { outlineCpu, type OutlineSettings } from './outline'

class FakeImageData {
  data: Uint8ClampedArray
  width: number
  height: number
  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.data = new Uint8ClampedArray(width * height * 4)
  }
}
;(globalThis as { ImageData?: unknown }).ImageData ??= FakeImageData

/** A 41×41 picture with a painted 5×5 square in the middle. */
function square() {
  const img = new FakeImageData(41, 41) as unknown as ImageData
  for (let y = 18; y <= 22; y++) for (let x = 18; x <= 22; x++) img.data.set([200, 0, 0, 255], (y * 41 + x) * 4)
  return img
}
const at = (img: ImageData, x: number, y: number) => [...img.data.slice((y * 41 + x) * 4, (y * 41 + x) * 4 + 4)]
const o = (p: Partial<OutlineSettings>): OutlineSettings => ({ size: 4, color: '#0000ff', where: 'outside', sharpness: 1, roundness: 1, ...p })

describe('outline engine', () => {
  it('rings the paint outside, keeps the paint, and stops at its size', () => {
    const out = outlineCpu(square(), o({}))
    expect(at(out, 20, 20)).toEqual([200, 0, 0, 255])
    expect(at(out, 25, 20)).toEqual([0, 0, 255, 255]) // 3 px out
    expect(at(out, 28, 20)[3]).toBe(0) // 6 px out
    // Round corners: the diagonal 3,3 px off the corner is ~4.2 px away, square corners reach it.
    expect(at(out, 26, 26)[3]).toBe(0)
    expect(at(outlineCpu(square(), o({ roundness: 0 })), 26, 26)[3]).toBe(255)
  })

  it('inside rings sit on the paint, ring only leaves the paint out, gradients fade', () => {
    const inside = outlineCpu(square(), o({ where: 'inside', size: 1 }))
    expect(at(inside, 18, 20)).toEqual([0, 0, 255, 255])
    expect(at(inside, 20, 20)).toEqual([200, 0, 0, 255])
    expect(at(inside, 16, 20)[3]).toBe(0)
    const ring = outlineCpu(square(), o({ where: 'inside', size: 1 }), true)
    expect(at(ring, 20, 20)[3]).toBe(0)
    const grad = outlineCpu(square(), o({ color: '#000000', color2: '#ffffff' }))
    expect(at(grad, 23, 20)[0]).toBeLessThan(at(grad, 26, 20)[0])
  })

  it('is fast enough for a stroke-sized piece', () => {
    const img = new FakeImageData(400, 400) as unknown as ImageData
    for (let i = 0; i < img.data.length; i += 4 * 7) img.data[i + 3] = 255
    const t = performance.now()
    outlineCpu(img, o({ size: 10 }))
    expect(performance.now() - t).toBeLessThan(500)
  })
})
