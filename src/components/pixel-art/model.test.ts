import { describe, expect, it } from 'vitest'
import { godotSpriteFrames, sheetJson } from './exports'
import { blank, brushOffsets, cleanPath, composite, ellipsePoints, floodPoints, getPx, line, parsePalette, ramp, rectPoints, setPx, shadeStep, tagFrames } from './model'

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

describe('pixel art exports', () => {
  const d = { width: 16, height: 8, frames: [{ id: 'a', duration: 100 }, { id: 'b', duration: 250 }, { id: 'c', duration: 100 }], tags: [{ id: 't', name: 'walk', from: 0, to: 2, color: '#fff', loop: 'pingpong' as const }] }
  it('lays out the sheet and its JSON', () => {
    const j = sheetJson(d, 'hero.png')
    expect(j.meta.size).toEqual({ w: 32, h: 16 })
    expect(j.frames[2].frame).toEqual({ x: 0, y: 8, w: 16, h: 8 })
    expect(j.meta.frameTags[0]).toEqual({ name: 'walk', from: 0, to: 2, direction: 'pingpong' })
  })
  it('writes a Godot SpriteFrames resource with one animation per tag', () => {
    const t = godotSpriteFrames(d, 'res://egd/sprites/hero.png')
    expect(t).toContain('region = Rect2(16, 0, 16, 8)')
    expect(t).toContain('"name": &"walk"')
    expect(t).toContain('"duration": 0.250')
    expect(t.match(/AtlasTexture_1"\)/g)).toHaveLength(2)
  })
})
