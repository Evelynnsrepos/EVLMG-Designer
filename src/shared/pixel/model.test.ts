import { describe, expect, it } from 'vitest'
import { sliceSheet } from './model'
import { blank, brushOffsets, cleanPath, composite, ellipsePoints, floodPoints, getPx, line, parsePalette, ramp, rectPoints, setPx, shadeStep, tagFrames, type Img } from './model'

describe('pixel art drawing', () => {
  it('draws exact lines and drops L corners for clean lines', () => {
    expect(line(0, 0, 3, 1)).toEqual([[0, 0], [1, 0], [2, 1], [3, 1]])
    expect(cleanPath([[0, 0], [1, 0], [1, 1], [2, 1]])).toEqual([[0, 0], [1, 1], [2, 1]])
    expect(cleanPath([[0, 0], [1, 0], [2, 0]])).toHaveLength(3)
  })

  it('makes square and round brushes, rectangles and ellipses', () => {
    expect(brushOffsets(1, true)).toEqual([[0, 0]])
    expect(brushOffsets(2, false)).toHaveLength(4)
    expect(brushOffsets(5, true).length).toBeLessThan(25)
    expect(rectPoints(0, 0, 2, 2, false)).toHaveLength(8)
    expect(rectPoints(2, 2, 0, 0, true)).toHaveLength(9)
    const e = ellipsePoints(0, 0, 6, 4, false)
    expect(e.length).toBeGreaterThan(10)
    expect(e.some(([x, y]) => x === 3 && y === 2)).toBe(false)
  })

  it('fills the connected area of one exact colour, or every match', () => {
    const img = blank(4, 3)
    for (let y = 0; y < 3; y++) setPx(img, 1, y, [255, 0, 0, 255])
    expect(floodPoints(img, 0, 0, true)).toHaveLength(3)
    expect(floodPoints(img, 0, 0, false)).toHaveLength(9)
  })

  it('composites layers with opacity', () => {
    const a = blank(1, 1)
    setPx(a, 0, 0, [0, 0, 255, 255])
    const b = blank(1, 1)
    setPx(b, 0, 0, [255, 0, 0, 255])
    expect(getPx(composite([{ visible: true, opacity: 1, img: a }, { visible: true, opacity: 0.5, img: b }], 1, 1), 0, 0)).toEqual([128, 0, 128, 255])
  })
})

describe('pixel art palette and animation', () => {
  it('steps along the palette and builds ramps from dark to light', () => {
    expect(shadeStep(['#000000', '#808080', '#ffffff'], '#808080', 1)).toBe('#ffffff')
    expect(shadeStep(['#000000'], '#123456', 1)).toBeNull()
    const r = ramp('#40a040', 5)
    expect(r).toHaveLength(5)
    expect(parseInt(r[0].slice(1), 16)).not.toBe(parseInt(r[4].slice(1), 16))
  })

  it('reads .gpl, .pal and .hex palettes', () => {
    expect(parsePalette('GIMP Palette\nName: x\n#\n255   0   0\tRed\n  0 255   0\n')).toEqual(['#ff0000', '#00ff00'])
    expect(parsePalette('JASC-PAL\n0100\n2\n0 0 255\n255 255 255\n')).toEqual(['#0000ff', '#ffffff'])
    expect(parsePalette('ff00ff\n#00FF00\n')).toEqual(['#ff00ff', '#00ff00'])
  })

  it('plays tags forward, reversed and ping-pong', () => {
    expect(tagFrames(null, 3)).toEqual([0, 1, 2])
    expect(tagFrames({ from: 1, to: 3, loop: 'reverse' }, 5)).toEqual([3, 2, 1])
    expect(tagFrames({ from: 0, to: 3, loop: 'pingpong' }, 5)).toEqual([0, 1, 2, 3, 2, 1])
  })
})

describe('sprite sheet import', () => {
  it('cuts a sheet into frames and skips empty cells', () => {
    const img = blank(6, 2)
    setPx(img, 0, 0, [1, 2, 3, 255])
    setPx(img, 5, 1, [4, 5, 6, 255])
    const frames = sliceSheet(img, 2, 2)
    expect(frames).toHaveLength(2)
    expect(getPx(frames[1], 1, 1)).toEqual([4, 5, 6, 255])
  })
})

describe('layers and links', () => {
  it('multiplies, and follows linked cels to the frame that holds the pixels', async () => {
    const { composite, resolveKey } = await import('./model')
    const a = blank(1, 1)
    setPx(a, 0, 0, [200, 100, 50, 255])
    const b = blank(1, 1)
    setPx(b, 0, 0, [128, 255, 0, 255])
    expect(getPx(composite([{ visible: true, opacity: 1, img: a }, { visible: true, opacity: 1, img: b, blend: 'multiply' }], 1, 1), 0, 0)).toEqual([100, 100, 0, 255])
    expect(resolveKey({ 'L:f2': '@f1', 'L:f3': '@f2', 'L:f1': 'data:x' }, 'L:f3')).toBe('L:f1')
  })
})

describe('tiles from a map picture', () => {
  it('keeps identical tiles once and extrudes edges', async () => {
    const { tilesFromMap, extrude } = await import('./model')
    const img = blank(6, 2)
    for (const x of [0, 1, 4, 5]) for (const y of [0, 1]) setPx(img, x, y, [9, 9, 9, 255])
    const r = tilesFromMap(img, 2)
    expect(r.count).toBe(1)
    expect(r.cells).toEqual({ '0,0': 0, '2,0': 0 })
    const e = extrude(r.sheet, 2)
    expect([e.width, e.height]).toEqual([4, 4])
    expect(getPx(e, 0, 0)).toEqual([9, 9, 9, 255])
  })
})

describe('shapePixels', async () => {
  const { shapePixels } = await import('./model')
  it('draws level shapes the crisp way and tilted ones as one clean line', () => {
    const box = shapePixels({ kind: 'rectangle', points: [{ x: 1, y: 1 }, { x: 8, y: 1 }, { x: 8, y: 5 }, { x: 1, y: 5 }] })
    expect(box).toHaveLength(22)
    const tilted = shapePixels({ kind: 'ellipse', points: [{ x: 20, y: 20 }, { x: 12, y: 5 }], angle: 0.7 })
    // Every pixel touches the next one (no gaps), and the loop closes.
    for (let i = 1; i < tilted.length; i++) expect(Math.max(Math.abs(tilted[i][0] - tilted[i - 1][0]), Math.abs(tilted[i][1] - tilted[i - 1][1]))).toBeLessThanOrEqual(1)
    const [a, b] = [tilted[0], tilted[tilted.length - 1]]
    expect(Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]))).toBeLessThanOrEqual(1)
  })
})

describe('composite with a flattened base', () => {
  it('gives the same picture as flattening every layer at once', () => {
    const img = (seed: number): Img => {
      const out = blank(5, 4)
      for (let i = 0; i < out.data.length; i++) out.data[i] = (i * seed * 37 + seed * 11) % 256
      return out
    }
    const layers = [1, 2, 3, 4].map((n, i) => ({ visible: true, opacity: 0.5 + i * 0.15, blend: (['normal', 'multiply', 'screen', 'normal'] as const)[i], img: img(n) }))
    const all = composite(layers, 5, 4)
    const below = composite(layers.slice(0, 2), 5, 4)
    const belowCopy = new Uint8ClampedArray(below.data)
    expect(composite(layers.slice(2), 5, 4, below).data).toEqual(all.data)
    expect(below.data).toEqual(belowCopy)
  })
})
