import { describe, expect, it } from 'vitest'
import { blank, celAlpha, getPx, setPx, tagFrames, type PixelTag } from '@/shared/pixel/model'
import { adjustColor, adjustImg, despeckle, dropShadow, hslToRgb, NO_ADJUST, rgbToHsl } from './adjust'

describe('pixel art colour adjustments and effects', () => {
  it('converts colours to HSL and back', () => {
    for (const c of [[255, 0, 0], [12, 200, 90], [128, 128, 128], [0, 0, 0]] as [number, number, number][]) expect(hslToRgb(...rgbToHsl(...c))).toEqual([...c])
  })
  it('adjusts hue, lightness, contrast and inverts', () => {
    expect(adjustColor([255, 0, 0, 255], { ...NO_ADJUST, hue: 120 })).toEqual([0, 255, 0, 255])
    expect(adjustColor([10, 20, 30, 200], { ...NO_ADJUST, invert: true })).toEqual([245, 235, 225, 200])
    expect(adjustColor([100, 100, 100, 255], { ...NO_ADJUST, lightness: 100 })).toEqual([255, 255, 255, 255])
    expect(adjustColor([100, 100, 100, 255], NO_ADJUST)).toEqual([100, 100, 100, 255])
    const img = blank(2, 1)
    setPx(img, 0, 0, [10, 10, 10, 255])
    setPx(img, 1, 0, [10, 10, 10, 255])
    const out = adjustImg(img, { ...NO_ADJUST, invert: true }, new Uint8Array([1, 0]))
    expect(getPx(out, 0, 0)).toEqual([245, 245, 245, 255])
    expect(getPx(out, 1, 0)).toEqual([10, 10, 10, 255])
  })
  it('drops a shadow behind the drawing and removes lone pixels', () => {
    const img = blank(4, 4)
    setPx(img, 1, 1, [9, 9, 9, 255])
    setPx(img, 2, 1, [9, 9, 9, 255])
    setPx(img, 3, 3, [9, 9, 9, 255])
    const s = dropShadow(img, 1, 1, [0, 0, 0, 255])
    expect(getPx(s, 2, 2)).toEqual([0, 0, 0, 255])
    expect(getPx(s, 2, 1)).toEqual([9, 9, 9, 255])
    const c = despeckle(img)
    expect(getPx(c, 3, 3)[3]).toBe(0)
    expect(getPx(c, 1, 1)[3]).toBe(255)
  })
  it('repeats tags and fades single frames', () => {
    const walk: PixelTag = { id: 't', name: 'walk', from: 1, to: 2, color: '#000', loop: 'forward', repeat: 3 }
    expect(tagFrames(walk, 4)).toEqual([1, 2, 1, 2, 1, 2])
    expect(tagFrames(null, 4, [walk])).toEqual([0, 1, 2, 1, 2, 1, 2, 3])
    expect(tagFrames(null, 4)).toEqual([0, 1, 2, 3])
    expect(celAlpha({ celOpacity: { 'l:f': 0.5 } }, { id: 'l', opacity: 0.8 }, 'f')).toBeCloseTo(0.4)
    expect(celAlpha({}, { id: 'l', opacity: 0.8 }, 'f')).toBe(0.8)
  })
})
