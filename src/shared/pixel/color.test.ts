import { describe, expect, it } from 'vitest'
import { grayscale, nearest, paletteOf, reduce, swapColors } from './color'
import { blank, getPx, setPx } from './model'

describe('pixel colours', () => {
  it('finds the closest palette colour and reduces a picture to the palette', () => {
    expect(nearest(['#000000', '#ffffff'], '#202020')).toBe('#000000')
    const img = blank(2, 1)
    setPx(img, 0, 0, [250, 240, 245, 255])
    const r = reduce(img, ['#000000', '#ffffff'])
    expect(getPx(r, 0, 0)).toEqual([255, 255, 255, 255])
    expect(getPx(r, 1, 0)[3]).toBe(0)
  })

  it('lists colours by use, makes grays and swaps palettes', () => {
    const img = blank(3, 1)
    setPx(img, 0, 0, [255, 0, 0, 255])
    setPx(img, 1, 0, [255, 0, 0, 255])
    setPx(img, 2, 0, [0, 0, 255, 255])
    expect(paletteOf(img)).toEqual(['#ff0000', '#0000ff'])
    expect(getPx(grayscale(img), 0, 0)).toEqual([76, 76, 76, 255])
    expect(getPx(swapColors(img, ['#ff0000'], ['#00ff00']), 1, 0)).toEqual([0, 255, 0, 255])
  })
})
