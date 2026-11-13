import { describe, expect, it, vi } from 'vitest'
import type { Img } from '@/shared/pixel/model'

// PNG encoding needs a browser canvas; keep the pictures in a map instead.
const store = new Map<string, Img>()
vi.mock('@/shared/pixel/codec', () => ({
  encode: (img: Img) => {
    if (img.data.every((v, i) => i % 4 !== 3 || v === 0)) return null
    const k = `png${store.size}`
    store.set(k, img)
    return k
  },
  celImg: (k: string | undefined, w: number, h: number) => (k && store.get(k)) || { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) },
}))
import { asSketchBlend, blank, celKey, composite, createPixelDoc, getPx, setPx, type PixelBlend, type PixelDoc } from '@/shared/pixel/model'
import { BLEND_MODES } from '@/shared/sketch/blend'
import { contentBounds, crop, flipSprite, resizeCanvas, sortPalette, stepLabel, turnSprite, unusedColors } from './docOps'

const RED = [255, 0, 0, 255] as const
/** A 4×2 sprite with one red pixel at (x, y). */
function doc(x: number, y: number): PixelDoc {
  const d = { ...createPixelDoc(), width: 4, height: 2, palette: ['#ff0000', '#00ff00'] }
  const img = blank(4, 2)
  setPx(img, x, y, [...RED])
  const k = `png${store.size}`
  store.set(k, img)
  return { ...d, cels: { [celKey(d.layers[0].id, d.frames[0].id)]: k } }
}
const only = (d: PixelDoc) => store.get(Object.values(d.cels)[0])!
const redAt = (d: PixelDoc) => {
  const img = only(d)
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (getPx(img, x, y)[3]) return [x, y]
  return null
}

describe('whole-sprite changes', () => {
  it('resizes the canvas around an anchor and crops', () => {
    const d = doc(0, 0)
    const big = resizeCanvas(d, 6, 4, 1, 1) // picture to the bottom right
    expect([big.width, big.height]).toEqual([6, 4])
    expect(redAt(big)).toEqual([2, 2])
    expect(redAt(crop(big, 2, 2, 1, 1))).toEqual([0, 0])
    expect(contentBounds(big)).toEqual({ x: 2, y: 2, w: 1, h: 1 })
  })
  it('flips and turns every cel', () => {
    const d = doc(0, 1)
    expect(redAt(flipSprite(d, 'x'))).toEqual([3, 1])
    expect(redAt(flipSprite(d, 'y'))).toEqual([0, 0])
    const t = turnSprite(d, true)
    expect([t.width, t.height]).toEqual([2, 4])
    expect(redAt(t)).toEqual([0, 0])
    expect(redAt(turnSprite(t, false))).toEqual([0, 1])
  })
  it('sorts the palette and finds unused colours', () => {
    expect(sortPalette(['#ffffff', '#000000', '#808080'], 'light')).toEqual(['#000000', '#808080', '#ffffff'])
    expect(sortPalette(['#0000ff', '#ff0000', '#777777'], 'hue')).toEqual(['#777777', '#ff0000', '#0000ff'])
    expect(unusedColors(doc(1, 1))).toEqual(['#00ff00'])
  })
  it('names undo steps', () => {
    const d = doc(0, 0)
    expect(stepLabel(d, resizeCanvas(d, 8, 8))).toBe('Canvas size 8×8')
    expect(stepLabel(d, { ...d, palette: [] })).toBe('Palette')
    expect(stepLabel(d, { ...d, selection: '0,1' })).toBe('Selection')
    expect(stepLabel(d, flipSprite(d, 'x'))).toMatch(/^Pixels on Layer 1|Whole sprite/)
  })
  it('blends layers with Draw\'s modes and the older ones', () => {
    const px = (r: number, g: number, b: number) => {
      const i = blank(1, 1)
      setPx(i, 0, 0, [r, g, b, 255])
      return i
    }
    const mixOf = (blend: PixelBlend) => getPx(composite([{ visible: true, opacity: 1, img: px(200, 100, 50) }, { visible: true, opacity: 1, img: px(100, 200, 50), blend }], 1, 1), 0, 0)
    expect(mixOf('darken')).toEqual([100, 100, 50, 255])
    expect(mixOf('difference')).toEqual([100, 100, 0, 255])
    expect(mixOf('add')).toEqual(mixOf('lighter'))
    for (const m of BLEND_MODES) for (const v of mixOf(m.id)) expect(v).toBeGreaterThanOrEqual(0)
    expect(asSketchBlend('add')).toBe('lighter')
    expect(asSketchBlend(undefined)).toBe('source-over')
  })

})
