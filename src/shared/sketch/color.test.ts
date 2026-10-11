import { describe, expect, it } from 'vitest'
import { colorName, discToSquare, squareToDisc, extractPalette, harmony, hexToHsb, hsbToHex, parseAco, parseAse, parseHexInput, parseSwatches, writeAse, writeSwatches } from './color'

describe('colour', () => {
  it('converts between hex and HSB', () => {
    expect(hexToHsb('#ff0000')).toEqual([0, 1, 1])
    expect(hsbToHex([120, 1, 1])).toBe('#00ff00')
    for (const hex of ['#123456', '#abcdef', '#808080', '#000000']) expect(hsbToHex(hexToHsb(hex))).toBe(hex)
    expect(parseHexInput('f80')).toBe('#ff8800')
    expect(parseHexInput('#12345')).toBeNull()
  })

  it('builds harmony schemes', () => {
    expect(harmony('#ff0000', 'complementary')).toEqual(['#ff0000', '#00ffff'])
    expect(harmony('#ff0000', 'triadic')).toEqual(['#ff0000', '#00ff00', '#0000ff'])
    expect(harmony('#ff0000', 'tetradic')).toHaveLength(4)
    expect(harmony('#ff0000', 'split')).toHaveLength(3)
    expect(harmony('#ff0000', 'analogous')[1]).toBe('#ff0080')
  })

  it('names colours', () => {
    expect(colorName('#fe0101')).toBe('Red')
    expect(colorName('#0a0a0a')).toMatch(/Black|Night/)
  })

  it('finds the main colours of an image', () => {
    const px = new Uint8ClampedArray(400 * 4)
    for (let i = 0; i < 400; i++) px.set(i < 300 ? [250, 10, 10, 255] : [10, 10, 250, 255], i * 4)
    const p = extractPalette(px, 4)
    expect(p[0]).toBe('#fa0a0a')
    expect(p).toContain('#0a0afa')
  })

  it('writes and reads .ase and .swatches', () => {
    const pal = { id: '', name: 'Test', colors: [{ hex: '#ff8800', name: 'Orange' }, { hex: '#123456' }] }
    const ase = parseAse(writeAse(pal).buffer as ArrayBuffer, 'x')
    expect(ase.colors).toEqual([{ hex: '#ff8800', name: 'Orange' }, { hex: '#123456' }])
    const sw = parseSwatches(writeSwatches(pal), 'x')
    expect(sw[0].name).toBe('Test')
    expect(sw[0].colors.map((c) => c.hex)).toEqual(['#ff8800', '#123456'])
  })

  it('reads .aco with names', () => {
    const b = new DataView(new ArrayBuffer(4 + 10 + 4 + 10 + 4 + 2 * 4))
    b.setUint16(0, 1)
    b.setUint16(2, 1)
    b.setUint16(4, 0)
    b.setUint16(6, 65535)
    b.setUint16(8, 0)
    b.setUint16(10, 32896)
    let o = 14
    b.setUint16(o, 2)
    b.setUint16(o + 2, 1)
    b.setUint16(o + 4, 0)
    b.setUint16(o + 6, 65535)
    b.setUint16(o + 8, 0)
    b.setUint16(o + 10, 32896)
    o += 14
    b.setUint32(o, 4)
    ;[...'Hey'].forEach((c, i) => b.setUint16(o + 4 + i * 2, c.charCodeAt(0)))
    const p = parseAco(b.buffer, 'A')
    expect(p.colors).toEqual([{ hex: '#ff0080', name: 'Hey' }])
  })
})

describe('round disc picker', () => {
  it('maps the square onto the circle and back', () => {
    for (const [u, v] of [[0, 0], [1, 1], [-1, 1], [0.3, -0.7], [1, 0]]) {
      const d = squareToDisc(u, v)
      expect(Math.hypot(d.x, d.y)).toBeLessThanOrEqual(1.000001)
      const back = discToSquare(d.x, d.y)
      expect(back.u).toBeCloseTo(u, 5)
      expect(back.v).toBeCloseTo(v, 5)
    }
  })
  it('treats a spot outside the circle as its edge', () => {
    expect(discToSquare(2, 2).u).toBeCloseTo(1, 5)
  })
})
