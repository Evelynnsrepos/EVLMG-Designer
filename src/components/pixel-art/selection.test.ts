import { describe, expect, it } from 'vitest'
import { blank, getPx, setPx } from '@/shared/pixel/model'
import { bounds, combine, cut, lassoMask, outline, paste, rectMask, rotate90, wandMask, wrapShift } from './selection'

describe('pixel art selection and transforms', () => {
  it('selects rectangles, lassos and exact colours, and combines them', () => {
    const r = rectMask(4, 4, 1, 1, 2, 2)
    expect(bounds(r, 4)).toEqual({ x: 1, y: 1, w: 2, h: 2 })
    expect(combine(r, rectMask(4, 4, 2, 2, 3, 3), 'subtract').reduce((a, b) => a + b, 0)).toBe(3)
    expect(lassoMask(5, 5, [[0, 0], [4, 0], [4, 4], [0, 4]]).reduce((a, b) => a + b, 0)).toBe(25)
    const img = blank(3, 1)
    setPx(img, 1, 0, [9, 9, 9, 255])
    expect([...wandMask(img, 0, 0, false)]).toEqual([1, 0, 1])
  })

  it('cuts, pastes, turns and outlines exactly', () => {
    const img = blank(3, 2)
    setPx(img, 0, 0, [255, 0, 0, 255])
    setPx(img, 2, 1, [0, 255, 0, 255])
    const c = cut(img, rectMask(3, 2, 0, 0, 0, 0))!
    expect(getPx(img, 0, 0)[3]).toBe(0)
    paste(img, c.piece, 1, 1)
    expect(getPx(img, 1, 1)).toEqual([255, 0, 0, 255])
    const t = rotate90(img, true)
    expect([t.width, t.height]).toEqual([2, 3])
    expect(getPx(t, 0, 2)).toEqual([0, 255, 0, 255])
    const dot = blank(3, 3)
    setPx(dot, 1, 1, [1, 1, 1, 255])
    const o = outline(dot, [5, 5, 5, 255])
    expect(getPx(o, 1, 0)).toEqual([5, 5, 5, 255])
    expect(getPx(o, 0, 0)[3]).toBe(0)
    expect(getPx(wrapShift(dot, 2, 0), 0, 1)).toEqual([1, 1, 1, 255])
  })
})

describe('pixel rotate and scale', () => {
  it('turns without new colours and scales with hard pixels', async () => {
    const { rotateAny, scaleImg } = await import('./selection')
    const img = blank(4, 4)
    for (let i = 0; i < 4; i++) setPx(img, i, 1, [200, 50, 50, 255])
    const r = rotateAny(img, 90)
    const colours = new Set<string>()
    for (let i = 0; i < r.data.length; i += 4) if (r.data[i + 3]) colours.add(String(r.data.slice(i, i + 3)))
    expect([...colours]).toEqual(['200,50,50'])
    const s = scaleImg(img, 8, 8)
    expect(getPx(s, 7, 2)).toEqual([200, 50, 50, 255])
  })
})

describe('pixel art selection tools (v0.29)', () => {
  it('grows, shrinks, borders, inverts and stores a selection', async () => {
    const { borderMask, ellipseMask, growMask, invertMask, maskToText, textToMask } = await import('./selection')
    const sum = (m: Uint8Array) => m.reduce((a, b) => a + b, 0)
    const dot = rectMask(5, 5, 2, 2, 2, 2)
    expect(sum(growMask(dot, 5, 5, 1))).toBe(9)
    expect(sum(growMask(growMask(dot, 5, 5, 1), 5, 5, -1))).toBe(1)
    const box = rectMask(5, 5, 0, 0, 4, 4)
    expect(sum(borderMask(box, 5, 5))).toBe(16)
    expect(sum(invertMask(dot))).toBe(24)
    const e = ellipseMask(5, 5, 0, 0, 4, 4)
    expect(e[12]).toBe(1)
    expect(e[0]).toBe(0)
    expect([...textToMask(maskToText(e), 25)!]).toEqual([...e])
  })
  it('fills and selects similar colours with a tolerance, and outlines inside', () => {
    const img = blank(3, 1)
    setPx(img, 0, 0, [100, 100, 100, 255])
    setPx(img, 1, 0, [104, 100, 100, 255])
    setPx(img, 2, 0, [200, 100, 100, 255])
    expect([...wandMask(img, 0, 0, true)]).toEqual([1, 0, 0])
    expect([...wandMask(img, 0, 0, true, 8)]).toEqual([1, 1, 0])
    const sq = blank(3, 3)
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) setPx(sq, x, y, [9, 9, 9, 255])
    const o = outline(sq, [255, 0, 0, 255], null, { inside: true })
    expect(getPx(o, 0, 0)).toEqual([255, 0, 0, 255])
    expect(getPx(o, 1, 1)).toEqual([9, 9, 9, 255])
  })
})
